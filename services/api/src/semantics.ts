import { canonicalize, digestBytes } from '@act/core';
import { verifyBytes, type SignedEnvelope } from '@act/crypto';
import type { StoredEvent } from '@act/ledger';
import { evaluateAuthoritySelection } from '@act/policy';
import { ApiProblemError, badRequest, conflict, forbidden } from './problem.js';
import type { LedgerContext } from './ledger-context.js';

interface EventBody {
  event_type: string;
  actor: { actor_id: string; key_id: string };
  subject: { kind: string; artifact_id?: string; version_id?: string };
  causal_parents: { event_id: string; relation?: string }[];
  extensions?: Record<string, unknown>;
  payload: Record<string, unknown>;
}

const body = (envelope: SignedEnvelope) => envelope.payload as unknown as EventBody;

function isArtifactEnvelope(value: unknown): value is Record<string, unknown> & {
  artifact_id: string;
  version_id: string;
  authoring_actor: { actor_id: string; key_id: string };
  signatures: { key_id: string; signature: string }[];
} {
  const v = value as Record<string, unknown> | null;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.artifact_id === 'string' &&
    typeof v.version_id === 'string' &&
    Array.isArray(v.signatures)
  );
}

/**
 * Recomputes what the protocol says must be recomputed at a trust boundary
 * (spec section 3): an artifact version id is the digest of the version's own
 * canonical content, so a claimed `version_id` is checked rather than
 * believed, and the artifact must really be authored and signed by the actor
 * that submits it.
 */
export function validateArtifactIntegrity(
  envelope: SignedEnvelope,
  publicKeys: Record<string, string>,
): void {
  const event = body(envelope);
  const artifact = event.payload;
  if (!isArtifactEnvelope(artifact)) return;

  if (event.subject.artifact_id !== artifact.artifact_id) {
    throw badRequest(
      'subject_payload_mismatch',
      'event subject.artifact_id does not match the artifact in the payload',
    );
  }
  if (event.subject.version_id !== artifact.version_id) {
    throw badRequest(
      'subject_payload_mismatch',
      'event subject.version_id does not match the artifact in the payload',
    );
  }
  const { version_id: claimed, signatures, ...unsigned } = artifact;
  const recomputed = digestBytes(canonicalize(unsigned));
  if (recomputed !== claimed) {
    throw badRequest(
      'version_id_mismatch',
      'The artifact version_id does not match the digest of its canonical content',
      `claimed ${claimed}, recomputed ${recomputed}`,
    );
  }
  const author = artifact.authoring_actor;
  // Selecting an effective version is a decision *about* someone else's
  // artifact version, so the selector is not its author; every other event
  // carries content its own actor authored.
  const authoredByActor = event.event_type !== 'intent_effective_selected';
  if (
    authoredByActor &&
    (author?.actor_id !== event.actor.actor_id || author?.key_id !== event.actor.key_id)
  ) {
    throw badRequest(
      'authoring_actor_mismatch',
      'The artifact names a different authoring actor than the event that submits it',
    );
  }
  const publicKey = publicKeys[author.key_id];
  // An unknown key has nothing to verify against; the ledger's own signature
  // step reports that as `invalid_signature`, which is the accurate answer.
  if (publicKey === undefined) return;
  const message = new TextEncoder().encode(canonicalize(unsigned));
  const signed = signatures.some(
    (s) => s.key_id === author.key_id && verifyBytes(publicKey, message, s.signature),
  );
  if (!signed) {
    throw badRequest(
      'artifact_signature_invalid',
      "The artifact carries no valid signature from its authoring actor's key",
    );
  }
}

const APPROVAL_TYPES = [
  'approval_requested',
  'approval_decided',
  'approval_cancelled',
  'approval_revoked',
  'approval_expired',
];

interface ApprovalRequestData {
  request_id: string;
  subject: { artifact_id: string; version_id: string };
  requested_by: { actor_id: string; key_id: string };
}
interface ApprovalDecisionData {
  decision_id: string;
  request_id: string;
  subject: { artifact_id: string; version_id: string };
  decision: string;
  reviewer: { actor_id: string; key_id: string };
  expires_at: string | null;
}

async function loadApprovalEvents(ctx: LedgerContext): Promise<StoredEvent[]> {
  const out: StoredEvent[] = [];
  let after = -1;
  for (;;) {
    const page = await ctx.ledger.queryEvents({ eventTypes: APPROVAL_TYPES }, 500, after);
    out.push(...page);
    if (page.length < 500) return out;
    after = page[page.length - 1]!.sequence;
  }
}

const dataOf = <T>(e: { envelope: SignedEnvelope } | EventBody, key: 'request' | 'decision'): T => {
  const payload = 'envelope' in e ? body(e.envelope).payload : (e as EventBody).payload;
  return (payload.data as Record<string, T>)[key]!;
};

/**
 * Enforces the approval lifecycle of spec/state-machines.md section 2 at write
 * time, so the ledger can never hold a decision on a request that does not
 * exist, a decision attributed to someone other than its signer, a second
 * decision by the same reviewer on one request, or a revocation of something
 * never approved.
 */
async function enforceApprovalLifecycle(
  ctx: LedgerContext,
  envelope: SignedEnvelope,
): Promise<void> {
  const event = body(envelope);
  const actor = event.actor;
  const same = (ref: { actor_id: string; key_id: string } | undefined) =>
    ref?.actor_id === actor.actor_id && ref?.key_id === actor.key_id;

  if (event.event_type === 'approval_requested') {
    const request = dataOf<ApprovalRequestData>(event, 'request');
    if (!same(request.requested_by)) {
      throw badRequest('actor_mismatch', 'requested_by must be the actor that signs the request');
    }
    const history = await loadApprovalEvents(ctx);
    if (
      history.some(
        (e) =>
          e.eventType === 'approval_requested' &&
          dataOf<ApprovalRequestData>(e, 'request').request_id === request.request_id,
      )
    ) {
      throw conflict('duplicate_request', `Approval request ${request.request_id} already exists`);
    }
    return;
  }

  const decision = dataOf<ApprovalDecisionData>(event, 'decision');
  if (!same(decision.reviewer)) {
    throw badRequest('actor_mismatch', 'reviewer must be the actor that signs the decision');
  }
  const history = await loadApprovalEvents(ctx);
  const requestEvent = history.find(
    (e) =>
      e.eventType === 'approval_requested' &&
      dataOf<ApprovalRequestData>(e, 'request').request_id === decision.request_id,
  );
  const decided = history.filter((e) => e.eventType === 'approval_decided');
  const cancelled = history.some(
    (e) =>
      e.eventType === 'approval_cancelled' &&
      dataOf<ApprovalDecisionData>(e, 'decision').request_id === decision.request_id,
  );

  switch (event.event_type) {
    case 'approval_decided': {
      if (!requestEvent) {
        throw conflict('unknown_approval_request', `No approval request ${decision.request_id}`);
      }
      const request = dataOf<ApprovalRequestData>(requestEvent, 'request');
      if (
        request.subject.artifact_id !== decision.subject.artifact_id ||
        request.subject.version_id !== decision.subject.version_id
      ) {
        throw conflict(
          'subject_mismatch',
          'A decision must name exactly the subject version its request named',
        );
      }
      if (cancelled) throw conflict('request_cancelled', 'The approval request was cancelled');
      if (
        decided.some((e) => {
          const d = dataOf<ApprovalDecisionData>(e, 'decision');
          return d.request_id === decision.request_id && d.reviewer.actor_id === actor.actor_id;
        })
      ) {
        throw conflict('already_decided', 'This reviewer has already decided this request');
      }
      return;
    }
    case 'approval_cancelled': {
      if (!requestEvent) {
        throw conflict('unknown_approval_request', `No approval request ${decision.request_id}`);
      }
      const request = dataOf<ApprovalRequestData>(requestEvent, 'request');
      if (request.requested_by.actor_id !== actor.actor_id) {
        throw forbidden('Only the requester may cancel an approval request');
      }
      if (
        cancelled ||
        decided.some(
          (e) => dataOf<ApprovalDecisionData>(e, 'decision').request_id === decision.request_id,
        )
      ) {
        throw conflict(
          'invalid_transition',
          'Only a request that is still pending can be cancelled',
        );
      }
      return;
    }
    case 'approval_revoked':
    case 'approval_expired': {
      const original = decided.find(
        (e) => dataOf<ApprovalDecisionData>(e, 'decision').decision_id === decision.decision_id,
      );
      if (!original) {
        throw conflict('unknown_approval', `No recorded decision ${decision.decision_id}`);
      }
      const originalData = dataOf<ApprovalDecisionData>(original, 'decision');
      if (originalData.decision !== 'approved') {
        throw conflict('invalid_transition', 'Only an approved decision can be revoked or expire');
      }
      const ended = history.some(
        (e) =>
          (e.eventType === 'approval_revoked' || e.eventType === 'approval_expired') &&
          dataOf<ApprovalDecisionData>(e, 'decision').decision_id === decision.decision_id,
      );
      if (ended) throw conflict('invalid_transition', 'This decision has already ended');
      if (event.event_type === 'approval_revoked') {
        if (originalData.reviewer.actor_id !== actor.actor_id) {
          throw forbidden('Only the reviewer who approved may revoke the approval');
        }
      } else if (!originalData.expires_at || Date.parse(originalData.expires_at) > Date.now()) {
        throw conflict('not_expired', 'The decision has no expiry, or its expiry has not elapsed');
      }
      return;
    }
  }
}

/**
 * Selecting or merging an effective intent is the one transition spec section
 * 7.3 reserves to an authority policy. With no authority policy configured the
 * answer is "no one", never "anyone".
 */
async function enforceIntentAuthority(ctx: LedgerContext, envelope: SignedEnvelope): Promise<void> {
  const authority = ctx.policy.authority;
  if (!authority) {
    throw new ApiProblemError(
      403,
      'authority_policy_required',
      'No authority policy is configured, so no one may select or merge an effective intent',
    );
  }
  const event = body(envelope);
  const data = (event.payload.data ?? {}) as { scope?: string };
  const branch = event.extensions?.branch;
  const scope = {
    project: String(data.scope ?? ''),
    ...(typeof branch === 'string' ? { branch } : {}),
  };

  const signerOwners = new Map<string, string[]>();
  for (const sig of envelope.signatures) {
    const owner = ctx.keyRegistry.get(sig.key_id)?.ownerActorId;
    if (owner) signerOwners.set(owner, authority.actorRoles[owner] ?? []);
  }
  const acting = [...signerOwners].map(([actorId, roles]) => ({ actorId, roles }));

  let proposedAuthor: string | undefined;
  const firstParent = event.causal_parents[0];
  if (firstParent) {
    const parent = await ctx.ledger.getEvent(firstParent.event_id);
    proposedAuthor = parent
      ? (parent.envelope.payload as unknown as EventBody).actor.actor_id
      : undefined;
  }
  const result = evaluateAuthoritySelection(authority.policy, scope, acting, proposedAuthor);
  if (!result.authorized) {
    throw new ApiProblemError(
      403,
      'authority_not_satisfied',
      'The signers do not satisfy the authority policy for this intent transition',
      result.reasons.join('; '),
    );
  }
}

/** Protocol rules beyond schema and signature validity, applied to every event the API accepts directly. */
export async function enforceProtocolSemantics(
  ctx: LedgerContext,
  envelope: SignedEnvelope,
  publicKeys: Record<string, string>,
): Promise<void> {
  validateArtifactIntegrity(envelope, publicKeys);
  const type = body(envelope).event_type;
  if (APPROVAL_TYPES.includes(type)) await enforceApprovalLifecycle(ctx, envelope);
  if (type === 'intent_effective_selected' || type === 'intent_merged') {
    await enforceIntentAuthority(ctx, envelope);
  }
}
