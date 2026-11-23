import { canonicalize, digestBytes, digestCanonicalValue, generateId } from '@act/core';
import { generateKeyPair, signBytes, signEnvelope, type Signer } from '@act/crypto';
import { buildUnsignedEvent } from '@act/sdk';
import type { LedgerContext } from '../ledger-context.js';

/**
 * The tenant stamped on every event the builders below create. An event must
 * name the tenant whose ledger records it (ADR 0010); tests that act as a
 * tenant other than `default` build their envelopes inside `withTenant`.
 */
export const testTenant = { current: 'default' };

/** Builds synchronously under `tenant`; every builder here is synchronous, so nothing can interleave. */
export function withTenant<T>(tenant: string, build: () => T): T {
  const previous = testTenant.current;
  testTenant.current = tenant;
  try {
    return build();
  } finally {
    testTenant.current = previous;
  }
}

export interface TestActor {
  actorId: string;
  signer: Signer;
}

export function makeActor(): TestActor {
  const kp = generateKeyPair();
  return {
    actorId: generateId(),
    signer: { keyId: kp.keyId, publicKey: kp.publicKey, privateKey: kp.privateKey },
  };
}

/** Builds and self-signs an ArtifactEnvelope-shaped record for `data`/`artifactType`, filling every other required field with fixture defaults. */
export function buildArtifactEnvelope(params: {
  actor: TestActor;
  artifactType: string;
  data: Record<string, unknown>;
  artifactId?: string;
  lineage?: { relation: string; target_version_id: string }[];
}): Record<string, unknown> {
  const unsigned = {
    artifact_id: params.artifactId ?? generateId(),
    schema_version: '1.0',
    protocol_version: 'act/1.0',
    authoring_actor: { actor_id: params.actor.actorId, key_id: params.actor.signer.keyId },
    created_at_claim: '2026-07-16T00:00:00Z',
    artifact_type: params.artifactType,
    content: {
      media_type: 'application/json',
      byte_length: 0,
      digest: `sha-256:${'0'.repeat(64)}`,
      storage: { kind: 'inline', inline_value: '' },
      sensitivity: 'internal',
      availability_state: 'available',
    },
    lineage: params.lineage ?? [],
    applicable_policy: { not_applicable: true, reason: 'test fixture' },
    confidence_assessments: [],
    uncertainties: [],
    evidence_refs: [],
    sensitivity: 'internal',
    retention_policy_id: null,
    data: params.data,
  };
  const versionId = digestBytes(canonicalize(unsigned));
  const signature = signBytes(
    params.actor.signer.privateKey,
    params.actor.signer.publicKey,
    new TextEncoder().encode(canonicalize(unsigned)),
  );
  return {
    ...unsigned,
    version_id: versionId,
    signatures: [{ key_id: params.actor.signer.keyId, algorithm: 'ed25519', signature }],
  };
}

export function buildKeyRegistrationEnvelope(actor: TestActor) {
  const keyArtifact = buildArtifactEnvelope({
    actor,
    artifactType: 'Key',
    data: {
      key_id: actor.signer.keyId,
      algorithm: 'ed25519',
      public_key: actor.signer.publicKey,
      status: 'active',
      owner_actor_id: actor.actorId,
    },
  });
  const event = buildUnsignedEvent({
    eventType: 'genesis',
    actor: { actorId: actor.actorId, keyId: actor.signer.keyId },
    tenant: testTenant.current,
    subject: {
      kind: 'artifact',
      artifact_id: keyArtifact.artifact_id as string,
      version_id: keyArtifact.version_id as string,
      artifact_type: 'Key',
    },
    payload: keyArtifact,
  });
  return signEnvelope(event, [actor.signer]);
}

export function buildActorRegistrationEnvelope(actor: TestActor, displayName: string) {
  const actorArtifact = buildArtifactEnvelope({
    actor,
    artifactType: 'Actor',
    artifactId: actor.actorId,
    data: { actor_type: 'human', display_name: displayName, keys: [actor.signer.keyId] },
  });
  const event = buildUnsignedEvent({
    eventType: 'genesis',
    actor: { actorId: actor.actorId, keyId: actor.signer.keyId },
    tenant: testTenant.current,
    subject: {
      kind: 'artifact',
      artifact_id: actor.actorId,
      version_id: actorArtifact.version_id as string,
      artifact_type: 'Actor',
    },
    payload: actorArtifact,
  });
  return signEnvelope(event, [actor.signer]);
}

export function buildApprovalRequestEnvelope(
  actor: TestActor,
  subjectArtifactId: string,
  subjectVersionId: string,
  causalParentEventId: string,
) {
  const requestId = generateId();
  const request = {
    request_id: requestId,
    subject: { artifact_id: subjectArtifactId, version_id: subjectVersionId },
    requested_by: { actor_id: actor.actorId, key_id: actor.signer.keyId },
    policy_id: generateId(),
    policy_version: `sha-256:${'1'.repeat(64)}`,
    requested_at: '2026-07-16T00:00:00Z',
    status: 'requested',
    signatures: [{ key_id: actor.signer.keyId, algorithm: 'ed25519', signature: 'ZmFrZQ==' }],
  };
  const artifact = buildArtifactEnvelope({
    actor,
    artifactType: 'ApprovalRequest',
    data: { request },
  });
  const event = buildUnsignedEvent({
    eventType: 'approval_requested',
    actor: { actorId: actor.actorId, keyId: actor.signer.keyId },
    tenant: testTenant.current,
    subject: {
      kind: 'attestation',
      artifact_id: artifact.artifact_id as string,
      version_id: artifact.version_id as string,
      artifact_type: 'ApprovalRequest',
    },
    causalParents: [{ event_id: causalParentEventId, relation: 'response-to' }],
    payload: artifact,
  });
  return { envelope: signEnvelope(event, [actor.signer]), requestId };
}

export function buildApprovalDecisionEnvelope(
  actor: TestActor,
  requestId: string,
  subjectArtifactId: string,
  subjectVersionId: string,
  causalParentEventId: string,
) {
  const decision = {
    decision_id: generateId(),
    request_id: requestId,
    subject: { artifact_id: subjectArtifactId, version_id: subjectVersionId },
    decision: 'approved',
    scope: 'test-scope',
    reviewer: { actor_id: actor.actorId, key_id: actor.signer.keyId },
    reviewer_authority: { assignment_id: generateId(), role: 'reviewer' },
    policy_id: generateId(),
    policy_version: `sha-256:${'1'.repeat(64)}`,
    conditions: [],
    comments: 'looks good',
    issued_at: '2026-07-16T01:00:00Z',
    expires_at: null,
    supersedes: null,
    signature: { key_id: actor.signer.keyId, algorithm: 'ed25519', signature: 'ZmFrZQ==' },
  };
  const artifact = buildArtifactEnvelope({
    actor,
    artifactType: 'ApprovalDecision',
    data: { decision },
  });
  const event = buildUnsignedEvent({
    eventType: 'approval_decided',
    actor: { actorId: actor.actorId, keyId: actor.signer.keyId },
    tenant: testTenant.current,
    subject: {
      kind: 'attestation',
      artifact_id: artifact.artifact_id as string,
      version_id: artifact.version_id as string,
      artifact_type: 'ApprovalDecision',
    },
    causalParents: [{ event_id: causalParentEventId, relation: 'response-to' }],
    payload: artifact,
  });
  return signEnvelope(event, [actor.signer]);
}

export function buildChallengeEnvelope(actor: TestActor, disputedClaim: string) {
  const challenge = {
    challenge_id: generateId(),
    disputed_claim: disputedClaim,
    challenger: { actor_id: actor.actorId, key_id: actor.signer.keyId },
    grounds: 'The classification is not supported by evidence.',
    evidence: [],
    requested_remedy: 'Reclassify as semantic-modification.',
    status: 'open',
    issued_at: '2026-07-16T02:00:00Z',
    signature: { key_id: actor.signer.keyId, algorithm: 'ed25519', signature: 'ZmFrZQ==' },
  };
  const artifact = buildArtifactEnvelope({ actor, artifactType: 'Challenge', data: { challenge } });
  const event = buildUnsignedEvent({
    eventType: 'challenge_raised',
    actor: { actorId: actor.actorId, keyId: actor.signer.keyId },
    tenant: testTenant.current,
    subject: {
      kind: 'attestation',
      artifact_id: artifact.artifact_id as string,
      version_id: artifact.version_id as string,
      artifact_type: 'Challenge',
    },
    causalParents: [{ event_id: disputedClaim, relation: 'response-to' }],
    payload: artifact,
  });
  return signEnvelope(event, [actor.signer]);
}

export function buildVerificationEnvelope(actor: TestActor, subjectDigest: string) {
  const artifact = buildArtifactEnvelope({
    actor,
    artifactType: 'VerificationReport',
    data: {
      result: 'pass',
      verifier: { actor_id: actor.actorId, key_id: actor.signer.keyId },
      method: 'schema-validation',
      method_version: '1.0.0',
      subject_digest: subjectDigest,
      execution_environment: 'test',
      limitations: 'structural only',
    },
  });
  const event = buildUnsignedEvent({
    eventType: 'verification_recorded',
    actor: { actorId: actor.actorId, keyId: actor.signer.keyId },
    tenant: testTenant.current,
    subject: {
      kind: 'attestation',
      artifact_id: artifact.artifact_id as string,
      version_id: artifact.version_id as string,
      artifact_type: 'VerificationReport',
    },
    causalParents: [{ event_id: subjectDigest, relation: 'response-to' }],
    payload: artifact,
  });
  return signEnvelope(event, [actor.signer]);
}

export function buildPolicyEnvelope(actor: TestActor, causalParentEventId: string) {
  const policy = {
    policy_id: generateId(),
    policy_version: `sha-256:${'4'.repeat(64)}`,
    kind: 'approval',
    name: 'test policy',
    issued_by: { actor_id: actor.actorId, key_id: actor.signer.keyId },
    issued_at: '2026-07-16T00:00:00Z',
    supersedes: null,
    rules: [
      {
        rule_id: 'r1',
        when: { subject_kind: ['artifact'] },
        require: { approval: true, quorum: 1 },
      },
    ],
    signatures: [{ key_id: actor.signer.keyId, algorithm: 'ed25519', signature: 'ZmFrZQ==' }],
  };
  const artifact = buildArtifactEnvelope({ actor, artifactType: 'Policy', data: { policy } });
  const event = buildUnsignedEvent({
    eventType: 'policy_published',
    actor: { actorId: actor.actorId, keyId: actor.signer.keyId },
    tenant: testTenant.current,
    subject: {
      kind: 'policy',
      artifact_id: artifact.artifact_id as string,
      version_id: artifact.version_id as string,
      artifact_type: 'Policy',
    },
    causalParents: [{ event_id: causalParentEventId, relation: 'response-to' }],
    payload: artifact,
  });
  return signEnvelope(event, [actor.signer]);
}

export function buildIntentEnvelope(actor: TestActor, statement: string) {
  const intentArtifact = buildArtifactEnvelope({
    actor,
    artifactType: 'Intent',
    data: { statement, scope: 'test' },
  });
  const event = buildUnsignedEvent({
    eventType: 'genesis',
    actor: { actorId: actor.actorId, keyId: actor.signer.keyId },
    tenant: testTenant.current,
    subject: {
      kind: 'artifact',
      artifact_id: intentArtifact.artifact_id as string,
      version_id: intentArtifact.version_id as string,
      artifact_type: 'Intent',
    },
    payload: intentArtifact,
  });
  return {
    envelope: signEnvelope(event, [actor.signer]),
    artifactId: intentArtifact.artifact_id as string,
    versionId: intentArtifact.version_id as string,
  };
}

/**
 * An `accountability_assigned` event (ADR 0011). Without `revises` it grants a
 * role; with it, it is the next version of that assignment.
 */
export function buildAssignmentEnvelope(params: {
  issuer: TestActor;
  assignee: TestActor;
  role: string;
  scope: string;
  /** Event this one responds to: the assignee's registration for a grant, the previous version's event for a revision. */
  parentEventId: string;
  assignmentId?: string;
  revises?: boolean;
  status?: 'active' | 'ended' | 'revoked';
  startTime?: string;
  endTime?: string | null;
  /** Lets a test forge who the assignment says issued it. */
  claimedIssuer?: TestActor;
}) {
  const assignmentId = params.assignmentId ?? generateId();
  const claimedIssuer = params.claimedIssuer ?? params.issuer;
  const artifact = buildArtifactEnvelope({
    actor: params.issuer,
    artifactType: 'AccountabilityAssignment',
    artifactId: assignmentId,
    data: {
      role: params.role,
      assignee: { actor_id: params.assignee.actorId, key_id: params.assignee.signer.keyId },
      scope: params.scope,
      issuer: { actor_id: claimedIssuer.actorId, key_id: claimedIssuer.signer.keyId },
      authority: 'test fixture',
      start_time: params.startTime ?? '2026-01-01T00:00:00Z',
      ...(params.endTime !== undefined ? { end_time: params.endTime } : {}),
      status: params.status ?? 'active',
    },
  });
  const event = buildUnsignedEvent({
    eventType: 'accountability_assigned',
    actor: { actorId: params.issuer.actorId, keyId: params.issuer.signer.keyId },
    tenant: testTenant.current,
    subject: {
      kind: 'artifact',
      artifact_id: assignmentId,
      version_id: artifact.version_id as string,
      artifact_type: 'AccountabilityAssignment',
    },
    causalParents: [
      {
        event_id: params.parentEventId,
        relation: params.revises ? 'revision-of' : 'input',
      },
    ],
    payload: artifact,
  });
  return { envelope: signEnvelope(event, [params.issuer.signer]), assignmentId };
}

/** The body that registers `other` as a federation peer, pinning its identity (as an operator would from GET /v1/ledger). */
export function peerRegistrationBody(
  url: string,
  other: LedgerContext,
  extra: Record<string, unknown> = {},
) {
  return {
    url,
    ledgerId: other.ledgerId,
    ledgerKeyId: other.ledgerSigner.keyId,
    ledgerPublicKey: other.ledgerSigner.publicKey,
    ...extra,
  };
}

/** Recomputes a bundle's id and signature after a test has edited it, acting as the (possibly malicious) signing peer. */
export function resignBundle(signer: LedgerContext, bundle: Record<string, any>) {
  const body = { ...bundle };
  delete body.bundle_id;
  delete body.signature;
  const bundleId = digestCanonicalValue(body);
  return {
    bundle_id: bundleId,
    ...body,
    signature: {
      key_id: signer.ledgerSigner.keyId,
      algorithm: 'ed25519',
      signature: signBytes(
        signer.ledgerSigner.privateKey,
        signer.ledgerSigner.publicKey,
        new TextEncoder().encode(bundleId),
      ),
    },
  };
}
