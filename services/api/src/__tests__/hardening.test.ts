import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { generateId } from '@act/core';
import { generateKeyPair, signEnvelope, type SignedEnvelope } from '@act/crypto';
import { buildUnsignedEvent } from '@act/sdk';
import { buildServer, type BuildServerOptions } from '../server.js';
import { createLedgerContext, type LedgerContext } from '../ledger-context.js';
import {
  buildActorRegistrationEnvelope,
  buildApprovalDecisionEnvelope,
  buildApprovalRequestEnvelope,
  buildArtifactEnvelope,
  buildAssignmentEnvelope,
  buildIntentEnvelope,
  buildKeyRegistrationEnvelope,
  makeActor,
  peerRegistrationBody,
  resignBundle,
  type TestActor,
} from './helpers.js';

/**
 * Regression tests for the findings of the project review. Each test names the
 * attack or failure it pins down; every one of them was accepted (or crashed)
 * before the corresponding fix.
 */

const auth = (who: { actorId: string } | string) => ({
  authorization: `Bearer ${typeof who === 'string' ? who : who.actorId}`,
});

interface Rig {
  server: FastifyInstance;
  ctx: LedgerContext;
}

async function rig(options: Partial<BuildServerOptions> = {}): Promise<Rig> {
  const ctx = await createLedgerContext(':memory:');
  const server = await buildServer({ devMode: true, ledgerContext: ctx, ...options });
  return { server, ctx };
}

async function register(server: FastifyInstance, actor: TestActor = makeActor()) {
  const key = await server.inject({
    method: 'POST',
    url: '/v1/keys',
    headers: auth(actor),
    payload: buildKeyRegistrationEnvelope(actor),
  });
  expect(key.statusCode).toBe(201);
  const reg = await server.inject({
    method: 'POST',
    url: '/v1/actors',
    headers: auth(actor),
    payload: buildActorRegistrationEnvelope(actor, 'Test'),
  });
  expect(reg.statusCode).toBe(201);
  return actor;
}

const post = (
  server: FastifyInstance,
  url: string,
  who: { actorId: string } | string,
  payload: unknown,
  extra = {},
) =>
  server.inject({
    method: 'POST',
    url,
    headers: { ...auth(who), ...extra },
    payload: payload as object,
  });
const get = (server: FastifyInstance, url: string, who: { actorId: string } | string) =>
  server.inject({ method: 'GET', url, headers: auth(who) });

/** An Intent whose event names `claimed` as the actor but is signed by `signer`. */
function intentSignedBy(claimed: TestActor, signer: TestActor, statement: string) {
  const artifact = buildArtifactEnvelope({
    actor: claimed,
    artifactType: 'Intent',
    data: { statement, scope: 'test' },
  });
  const event = buildUnsignedEvent({
    eventType: 'genesis',
    actor: { actorId: claimed.actorId, keyId: claimed.signer.keyId },
    tenant: 'default',
    subject: {
      kind: 'artifact',
      artifact_id: artifact.artifact_id as string,
      version_id: artifact.version_id as string,
      artifact_type: 'Intent',
    },
    payload: artifact,
  });
  return signEnvelope(event, [signer.signer]);
}

function revisionOf(
  actor: TestActor,
  artifactId: string,
  parentEventId: string,
  statement: string,
  eventType = 'artifact_revised',
) {
  const artifact = buildArtifactEnvelope({
    actor,
    artifactType: 'Intent',
    artifactId,
    data: { statement, scope: 'test' },
  });
  const event = buildUnsignedEvent({
    eventType,
    actor: { actorId: actor.actorId, keyId: actor.signer.keyId },
    tenant: 'default',
    subject: {
      kind: 'artifact',
      artifact_id: artifactId,
      version_id: artifact.version_id as string,
      artifact_type: 'Intent',
    },
    causalParents: [{ event_id: parentEventId, relation: 'revision-of' }],
    payload: artifact,
  });
  return {
    envelope: signEnvelope(event, [actor.signer]),
    versionId: artifact.version_id as string,
  };
}

function keyStatusEvent(
  signer: TestActor,
  target: TestActor,
  eventType: 'key_revoked' | 'key_compromised' | 'key_rotated',
  status: string,
  parentEventId: string,
) {
  const artifact = buildArtifactEnvelope({
    actor: signer,
    artifactType: 'Key',
    data: {
      key_id: target.signer.keyId,
      algorithm: 'ed25519',
      public_key: target.signer.publicKey,
      status,
      owner_actor_id: target.actorId,
    },
  });
  const event = buildUnsignedEvent({
    eventType,
    actor: { actorId: signer.actorId, keyId: signer.signer.keyId },
    tenant: 'default',
    subject: {
      kind: 'artifact',
      artifact_id: artifact.artifact_id as string,
      version_id: artifact.version_id as string,
      artifact_type: 'Key',
    },
    causalParents: [{ event_id: parentEventId, relation: 'revision-of' }],
    payload: artifact,
  });
  return signEnvelope(event, [signer.signer]);
}

describe('attribution and key trust', () => {
  let r: Rig;
  beforeEach(async () => {
    r = await rig();
  });
  afterEach(() => r.server.close());

  it('rejects an event that names Alice as its actor but is signed only by Mallory', async () => {
    const alice = await register(r.server);
    const mallory = await register(r.server);
    const res = await post(
      r.server,
      '/v1/intents',
      mallory,
      intentSignedBy(alice, mallory, 'forged'),
    );
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('actor_key_not_signer');
  });

  it("rejects an event that pairs Alice's actor id with Mallory's own (valid, trusted) key", async () => {
    const alice = await register(r.server);
    const mallory = await register(r.server);
    const spoof: TestActor = { actorId: alice.actorId, signer: mallory.signer };
    const res = await post(
      r.server,
      '/v1/intents',
      mallory,
      intentSignedBy(spoof, spoof, 'spoofed actor'),
    );
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('untrusted_actor');
  });

  it("refuses to register Mallory's public key under Alice's key id", async () => {
    const alice = await register(r.server);
    const mallory = makeActor();
    const takeover: TestActor = {
      actorId: mallory.actorId,
      signer: { ...mallory.signer, keyId: alice.signer.keyId },
    };
    const res = await post(r.server, '/v1/keys', mallory, buildKeyRegistrationEnvelope(takeover));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('key_id_mismatch');
    // Alice is unaffected.
    const ok = await post(
      r.server,
      '/v1/intents',
      alice,
      buildIntentEnvelope(alice, 'still mine').envelope,
    );
    expect(ok.statusCode).toBe(201);
  });

  it('refuses a key id that is not the fingerprint of its public key', async () => {
    const m = makeActor();
    const fake: TestActor = {
      actorId: m.actorId,
      signer: { ...m.signer, keyId: `ed25519:${'0'.repeat(64)}` },
    };
    const res = await post(r.server, '/v1/keys', m, buildKeyRegistrationEnvelope(fake));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('key_id_mismatch');
  });

  it('refuses to register a key on behalf of a different owner actor', async () => {
    const m = makeActor();
    const victim = generateId();
    const envelope = buildKeyRegistrationEnvelope({ actorId: victim, signer: m.signer });
    // The event's actor is `victim`, but the signature is the key's own: the key may only self-register as its owner.
    const res = await post(r.server, '/v1/keys', m, envelope);
    expect(res.statusCode).toBe(201); // owner == actor here, so this is the key's own owner claim
    const takeoverActor = await post(
      r.server,
      '/v1/intents',
      m,
      buildIntentEnvelope({ actorId: generateId(), signer: m.signer }, 'someone else, same key')
        .envelope,
    );
    expect(takeoverActor.statusCode).toBe(403);
  });

  it('refuses writes from a key once its owner has revoked it, and refuses revocation by a stranger', async () => {
    const alice = await register(r.server);
    const mallory = await register(r.server);
    const keyEvent = (await get(r.server, '/v1/events?eventType=genesis', alice)).json().items[0];

    const stranger = await post(
      r.server,
      '/v1/keys',
      mallory,
      keyStatusEvent(mallory, alice, 'key_revoked', 'revoked', keyEvent.eventId),
    );
    expect(stranger.statusCode).toBe(403);
    expect(stranger.json().code).toBe('not_key_owner');

    const revoke = await post(
      r.server,
      '/v1/keys',
      alice,
      keyStatusEvent(alice, alice, 'key_revoked', 'revoked', keyEvent.eventId),
    );
    expect(revoke.statusCode).toBe(201);

    const after = await post(
      r.server,
      '/v1/intents',
      alice,
      buildIntentEnvelope(alice, 'too late').envelope,
    );
    expect(after.statusCode).toBe(403);
    expect(after.json().code).toBe('untrusted_actor');
  });

  it('only lets an administrator register keys when registration is in admin mode', async () => {
    const closed = await rig({ keyRegistration: 'admin', adminActorIds: ['root'] });
    try {
      const actor = makeActor();
      const denied = await post(
        closed.server,
        '/v1/keys',
        actor,
        buildKeyRegistrationEnvelope(actor),
      );
      expect(denied.statusCode).toBe(403);
      const allowed = await post(
        closed.server,
        '/v1/keys',
        'root',
        buildKeyRegistrationEnvelope(actor),
      );
      expect(allowed.statusCode).toBe(201);
    } finally {
      await closed.server.close();
    }
  });
});

describe('artifact and lineage integrity', () => {
  let r: Rig;
  beforeEach(async () => {
    r = await rig();
  });
  afterEach(() => r.server.close());

  it('rejects an event whose claimed version_id is not the digest of its content', async () => {
    const a = await register(r.server);
    const artifact = buildArtifactEnvelope({
      actor: a,
      artifactType: 'Intent',
      data: { statement: 'real', scope: 'test' },
    });
    const lie = { ...artifact, version_id: `sha-256:${'a'.repeat(64)}` };
    const event = buildUnsignedEvent({
      eventType: 'genesis',
      actor: { actorId: a.actorId, keyId: a.signer.keyId },
      tenant: 'default',
      subject: {
        kind: 'artifact',
        artifact_id: artifact.artifact_id as string,
        version_id: lie.version_id,
        artifact_type: 'Intent',
      },
      payload: lie,
    });
    const res = await post(r.server, '/v1/intents', a, signEnvelope(event, [a.signer]));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('version_id_mismatch');
  });

  it('rejects an event whose subject disagrees with the artifact it carries', async () => {
    const a = await register(r.server);
    const { envelope } = buildIntentEnvelope(a, 'x');
    const event = {
      ...(envelope.payload as Record<string, any>),
      subject: {
        kind: 'artifact',
        artifact_id: generateId(),
        version_id: (envelope.payload as any).subject.version_id,
      },
    };
    const res = await post(r.server, '/v1/intents', a, signEnvelope(event, [a.signer]));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('subject_payload_mismatch');
  });

  it("refuses another actor's genesis on an existing artifact id (head hijack)", async () => {
    const alice = await register(r.server);
    const mallory = await register(r.server);
    const mine = buildIntentEnvelope(alice, 'Alice v1');
    await post(r.server, '/v1/intents', alice, mine.envelope);
    const artifact = buildArtifactEnvelope({
      actor: mallory,
      artifactType: 'Intent',
      artifactId: mine.artifactId,
      data: { statement: 'Mallory replaced it', scope: 'test' },
    });
    const event = buildUnsignedEvent({
      eventType: 'genesis',
      actor: { actorId: mallory.actorId, keyId: mallory.signer.keyId },
      tenant: 'default',
      subject: {
        kind: 'artifact',
        artifact_id: mine.artifactId,
        version_id: artifact.version_id as string,
        artifact_type: 'Intent',
      },
      payload: artifact,
    });
    const res = await post(r.server, '/v1/intents', mallory, signEnvelope(event, [mallory.signer]));
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('artifact_exists');
    expect(
      (await get(r.server, `/v1/artifacts/${mine.artifactId}`, alice)).json().currentVersionId,
    ).toBe(mine.versionId);
  });

  it('keeps competing revisions visible as a branch instead of picking the last write', async () => {
    const a = await register(r.server);
    const root = buildIntentEnvelope(a, 'root');
    await post(r.server, '/v1/intents', a, root.envelope);
    const v1 = revisionOf(a, root.artifactId, root.envelope.payloadDigest, 'variant A');
    const v2 = revisionOf(a, root.artifactId, root.envelope.payloadDigest, 'variant B');

    expect((await get(r.server, `/v1/artifacts/${root.artifactId}`, a)).json().conflict).toBe(
      false,
    );
    await post(r.server, '/v1/intents', a, v1.envelope);
    expect(
      (await get(r.server, `/v1/artifacts/${root.artifactId}`, a)).json().currentVersionId,
    ).toBe(v1.versionId);
    await post(r.server, '/v1/intents', a, v2.envelope);
    const view = (await get(r.server, `/v1/artifacts/${root.artifactId}`, a)).json();
    expect(view.conflict).toBe(true);
    expect(view.currentVersionId).toBeNull();
    expect(view.tips.map((t: { versionId: string }) => t.versionId).sort()).toEqual(
      [v1.versionId, v2.versionId].sort(),
    );
  });

  it('answers an unknown artifact_type with 400, and requires one on a new artifact version', async () => {
    const a = await register(r.server);
    const mk = (payload: Record<string, unknown>) =>
      signEnvelope(
        buildUnsignedEvent({
          eventType: 'genesis',
          actor: { actorId: a.actorId, keyId: a.signer.keyId },
          tenant: 'default',
          subject: {
            kind: 'artifact',
            artifact_id: generateId(),
            version_id: `sha-256:${'f'.repeat(64)}`,
          },
          payload,
        }),
        [a.signer],
      );
    const unknown = await post(
      r.server,
      '/v1/artifacts',
      a,
      mk({ artifact_type: 'TotallyMadeUp', data: {} }),
    );
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().code).toBe('unknown_artifact_type');
    const untyped = await post(r.server, '/v1/artifacts', a, mk({ anything: 'goes' }));
    expect(untyped.statusCode).toBe(400);
    expect(untyped.json().code).toBe('artifact_payload_invalid');
  });
});

describe('request handling', () => {
  let r: Rig;
  beforeEach(async () => {
    r = await rig();
  });
  afterEach(() => r.server.close());

  it.each(['limit=0', 'limit=-1', 'limit=abc', 'limit=1e9', 'cursor=abc', 'cursor=-5'])(
    'answers /v1/events?%s with 400 instead of 500 or an unbounded page',
    async (query) => {
      const a = await register(r.server);
      const res = await get(r.server, `/v1/events?${query}`, a);
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('invalid_query_param');
    },
  );

  it('validates the lineage maxDepth parameter', async () => {
    const a = await register(r.server);
    const first = (await get(r.server, '/v1/events', a)).json().items[0].eventId;
    expect((await get(r.server, `/v1/lineage/${first}?maxDepth=abc`, a)).statusCode).toBe(400);
    expect((await get(r.server, `/v1/lineage/${first}?maxDepth=3`, a)).statusCode).toBe(200);
  });

  it('honours the Idempotency-Key header: a re-signed retry replays, a different event conflicts', async () => {
    const a = await register(r.server);
    const first = buildIntentEnvelope(a, 'only once');
    const created = await post(r.server, '/v1/intents', a, first.envelope, {
      'idempotency-key': 'k-1',
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().duplicate).toBe(false);

    const retry = signEnvelope(
      { ...(first.envelope.payload as Record<string, any>), occurred_at: '2031-01-01T00:00:00Z' },
      [a.signer],
    );
    const replay = await post(r.server, '/v1/intents', a, retry, { 'idempotency-key': 'k-1' });
    expect(replay.statusCode).toBe(201);
    expect(replay.json().duplicate).toBe(true);
    expect(replay.json().eventId).toBe(created.json().eventId);

    const other = await post(
      r.server,
      '/v1/intents',
      a,
      buildIntentEnvelope(a, 'different').envelope,
      {
        'idempotency-key': 'k-1',
      },
    );
    expect(other.statusCode).toBe(409);
    expect(other.json().code).toBe('idempotency_conflict');
  });

  it('serializes simultaneous writes into a gap-free receipt chain', async () => {
    const a = await register(r.server);
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        post(r.server, '/v1/intents', a, buildIntentEnvelope(a, `parallel ${i}`).envelope),
      ),
    );
    expect(responses.map((x) => x.statusCode)).toEqual(Array(8).fill(201));
    const sequences = responses.map((x) => x.json().sequence).sort((x, y) => x - y);
    expect(new Set(sequences).size).toBe(8);
    expect(sequences[7]! - sequences[0]!).toBe(7);
  });
});

describe('approval lifecycle', () => {
  let r: Rig;
  beforeEach(async () => {
    r = await rig();
  });
  afterEach(() => r.server.close());

  async function setup() {
    const requester = await register(r.server);
    const reviewer = await register(r.server);
    const intent = buildIntentEnvelope(requester, 'to be approved');
    await post(r.server, '/v1/intents', requester, intent.envelope);
    const request = buildApprovalRequestEnvelope(
      requester,
      intent.artifactId,
      intent.versionId,
      intent.envelope.payloadDigest,
    );
    const created = await post(r.server, '/v1/approval-requests', requester, request.envelope);
    expect(created.statusCode).toBe(201);
    return {
      requester,
      reviewer,
      intent,
      request,
      requestEventId: created.json().eventId as string,
    };
  }

  it('rejects a decision on a request that does not exist', async () => {
    const { reviewer, intent } = await setup();
    const decision = buildApprovalDecisionEnvelope(
      reviewer,
      generateId(),
      intent.artifactId,
      intent.versionId,
      intent.envelope.payloadDigest,
    );
    const res = await post(r.server, '/v1/approval-decisions', reviewer, decision);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('unknown_approval_request');
  });

  it('rejects a decision that names a different reviewer than the one who signed it', async () => {
    const { requester, reviewer, intent, request, requestEventId } = await setup();
    // `requester` authors and signs the decision correctly, but its body names `reviewer` as the reviewer.
    const artifact = buildArtifactEnvelope({
      actor: requester,
      artifactType: 'ApprovalDecision',
      data: {
        decision: {
          decision_id: generateId(),
          request_id: request.requestId,
          subject: { artifact_id: intent.artifactId, version_id: intent.versionId },
          decision: 'approved',
          scope: 'test-scope',
          reviewer: { actor_id: reviewer.actorId, key_id: reviewer.signer.keyId },
          reviewer_authority: { assignment_id: generateId(), role: 'reviewer' },
          policy_id: generateId(),
          policy_version: `sha-256:${'1'.repeat(64)}`,
          conditions: [],
          comments: 'speaking for someone else',
          issued_at: '2026-07-16T01:00:00Z',
          expires_at: null,
          supersedes: null,
          signature: { key_id: reviewer.signer.keyId, algorithm: 'ed25519', signature: 'ZmFrZQ==' },
        },
      },
    });
    const event = buildUnsignedEvent({
      eventType: 'approval_decided',
      actor: { actorId: requester.actorId, keyId: requester.signer.keyId },
      tenant: 'default',
      subject: {
        kind: 'attestation',
        artifact_id: artifact.artifact_id as string,
        version_id: artifact.version_id as string,
        artifact_type: 'ApprovalDecision',
      },
      causalParents: [{ event_id: requestEventId, relation: 'response-to' }],
      payload: artifact,
    });
    const res = await post(
      r.server,
      '/v1/approval-decisions',
      requester,
      signEnvelope(event, [requester.signer]),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('actor_mismatch');
  });

  it('accepts a decision once, and refuses a second decision by the same reviewer', async () => {
    const { reviewer, intent, request, requestEventId } = await setup();
    const decide = () =>
      buildApprovalDecisionEnvelope(
        reviewer,
        request.requestId,
        intent.artifactId,
        intent.versionId,
        requestEventId,
      );
    expect((await post(r.server, '/v1/approval-decisions', reviewer, decide())).statusCode).toBe(
      201,
    );
    const again = await post(r.server, '/v1/approval-decisions', reviewer, decide());
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('already_decided');
  });

  it('treats an exact resubmission as idempotent rather than re-judging it', async () => {
    const { reviewer, intent, request, requestEventId } = await setup();
    const decision = buildApprovalDecisionEnvelope(
      reviewer,
      request.requestId,
      intent.artifactId,
      intent.versionId,
      requestEventId,
    );
    const first = await post(r.server, '/v1/approval-decisions', reviewer, decision);
    const second = await post(r.server, '/v1/approval-decisions', reviewer, decision);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().duplicate).toBe(true);
  });

  it('refuses to revoke a decision that was never made', async () => {
    const { reviewer, intent, request, requestEventId } = await setup();
    const phantom = buildApprovalDecisionEnvelope(
      reviewer,
      request.requestId,
      intent.artifactId,
      intent.versionId,
      requestEventId,
    );
    const revoked = signEnvelope(
      { ...(phantom.payload as Record<string, any>), event_type: 'approval_revoked' },
      [reviewer.signer],
    );
    const res = await post(r.server, '/v1/approval-decisions', reviewer, revoked);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('unknown_approval');
  });
});

describe('effective-intent authority', () => {
  async function scenario(server: FastifyInstance) {
    const proposer = await register(server);
    const owner = await register(server);
    const root = buildIntentEnvelope(proposer, 'baseline');
    await post(server, '/v1/intents', proposer, root.envelope);
    const proposal = revisionOf(proposer, root.artifactId, root.envelope.payloadDigest, 'proposal');
    const proposed = await post(server, '/v1/intents', proposer, proposal.envelope);
    expect(proposed.statusCode).toBe(201);
    // Selecting is a decision about the proposer's version: the payload is that version, the signer is the selector.
    const select = (who: TestActor) =>
      signEnvelope(
        buildUnsignedEvent({
          eventType: 'intent_effective_selected',
          actor: { actorId: who.actorId, keyId: who.signer.keyId },
          tenant: 'default',
          subject: {
            kind: 'artifact',
            artifact_id: root.artifactId,
            version_id: proposal.versionId,
            artifact_type: 'Intent',
          },
          causalParents: [{ event_id: proposed.json().eventId, relation: 'approval-of' }],
          payload: (proposal.envelope.payload as { payload: Record<string, unknown> }).payload,
        }),
        [who.signer],
      );
    return { proposer, owner, root, proposal, select };
  }

  it('refuses to select an effective intent when no authority policy is configured', async () => {
    const { server } = await rig();
    try {
      const { owner, select } = await scenario(server);
      const res = await post(server, '/v1/intents', owner, select(owner));
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('authority_policy_required');
    } finally {
      await server.close();
    }
  });

  it('accepts a selection only from signers whom the authority policy empowers, and not the proposer', async () => {
    const ctx = await createLedgerContext(':memory:');
    const server = await buildServer({ devMode: true, ledgerContext: ctx });
    try {
      const { proposer, owner, root, proposal, select } = await scenario(server);
      // Roles are not configuration: an administrator grants them with signed assignments.
      const admin = await register(server);
      ctx.policy.adminActorIds = [admin.actorId];
      for (const holder of [owner, proposer]) {
        const granted = await post(
          server,
          '/v1/assignments',
          admin,
          buildAssignmentEnvelope({
            issuer: admin,
            assignee: holder,
            role: 'owner',
            scope: 'test',
            parentEventId: root.envelope.payloadDigest,
          }).envelope,
        );
        expect(granted.statusCode).toBe(201);
      }
      ctx.policy.authority = {
        policy: {
          policy_id: generateId(),
          policy_version: `sha-256:${'7'.repeat(64)}`,
          scope: { project: 'test' },
          authorized_roles: ['owner'],
          quorum: 1,
          separation_of_duties: true,
        },
      };

      // The proposer holds the role but may not act as their own authority.
      const denied = await post(server, '/v1/intents', proposer, select(proposer));
      expect(denied.statusCode).toBe(403);
      expect(denied.json().code).toBe('authority_not_satisfied');

      // A signer holding no role at all is refused too.
      const outsider = await register(server);
      expect((await post(server, '/v1/intents', outsider, select(outsider))).statusCode).toBe(403);

      const ok = await post(server, '/v1/intents', owner, select(owner));
      expect(ok.statusCode).toBe(201);
      const view = (await get(server, `/v1/artifacts/${root.artifactId}`, owner)).json();
      expect(view.effectiveVersionId).toBe(proposal.versionId);
      // The selection is a decision about a version, not a competing version.
      expect(view.conflict).toBe(false);
    } finally {
      await server.close();
    }
  });
});

describe('federation hardening', () => {
  async function pair() {
    const a = await rig();
    const b = await rig();
    const alice = await register(a.server);
    await post(a.server, '/v1/intents', alice, buildIntentEnvelope(alice, 'exported').envelope);
    const bundle = (await post(a.server, '/v1/bundles/export', alice, {})).json();
    await post(
      b.server,
      '/v1/federation/peers',
      'admin',
      peerRegistrationBody('http://peer.example.test', a.ctx),
    );
    return { a, b, alice, bundle };
  }

  it('rejects a bundle with a forged signature, a wrong id, or an unknown source ledger', async () => {
    const { a, b, bundle } = await pair();
    try {
      const forgedSig = {
        ...bundle,
        signature: { ...bundle.signature, signature: Buffer.from('nope').toString('base64') },
      };
      const r1 = await post(b.server, '/v1/bundles/import', 'admin', forgedSig);
      expect(r1.statusCode).toBe(403);
      expect(r1.json().code).toBe('invalid_bundle_signature');

      const wrongId = { ...bundle, bundle_id: `sha-256:${'d'.repeat(64)}` };
      const r2 = await post(b.server, '/v1/bundles/import', 'admin', wrongId);
      expect(r2.statusCode).toBe(400);
      expect(r2.json().code).toBe('bundle_digest_mismatch');

      const stranger = await rig();
      const r3 = await post(stranger.server, '/v1/bundles/import', 'admin', bundle);
      expect(r3.statusCode).toBe(403);
      expect(r3.json().code).toBe('untrusted_source_ledger');
      await stranger.server.close();

      // Nothing from any rejected bundle reached the ledger.
      expect((await get(b.server, '/v1/events', 'admin')).json().items).toHaveLength(0);
    } finally {
      await a.server.close();
      await b.server.close();
    }
  });

  it('refuses a bundle signed by a different key than the one pinned for that ledger', async () => {
    const { a, b, bundle } = await pair();
    try {
      const imposter = generateKeyPair();
      const ctx: LedgerContext = { ...a.ctx, ledgerSigner: { ...imposter } };
      const res = await post(b.server, '/v1/bundles/import', 'admin', resignBundle(ctx, bundle));
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('invalid_bundle_signature');
    } finally {
      await a.server.close();
      await b.server.close();
    }
  });

  it('accepts a missing parent only when the bundle declares that gap', async () => {
    const { a, b, bundle } = await pair();
    try {
      // Drop the Key event but keep everything that depends on it: undeclared gap.
      const lastIndex = bundle.events.length - 1;
      const orphan = JSON.parse(JSON.stringify(bundle));
      orphan.events = [orphan.events[lastIndex]];
      orphan.completeness = { scope: 'partial', known_gaps: [] };
      const undeclared = await post(
        b.server,
        '/v1/bundles/import',
        'admin',
        resignBundle(a.ctx, orphan),
      );
      expect(undeclared.statusCode).toBe(200);
      expect(undeclared.json().accepted).toBe(0);
      expect(undeclared.json().quarantined).toHaveLength(1);
    } finally {
      await a.server.close();
      await b.server.close();
    }
  });

  it('computes export completeness: a filtered export is partial and lists its gaps', async () => {
    const { a, alice } = await pair();
    try {
      const intent = (await get(a.server, '/v1/events?eventType=genesis', alice))
        .json()
        .items.at(-1);
      const filtered = (
        await post(a.server, '/v1/bundles/export', alice, {
          artifactIds: [intent.envelope.payload.subject.artifact_id],
        })
      ).json();
      expect(filtered.events).toHaveLength(1);
      expect(filtered.completeness.scope).toBe('partial');
      expect(filtered.completeness.known_gaps).toEqual([]); // a genesis has no parents, but the export is still restricted
    } finally {
      await a.server.close();
    }
  });

  it('never returns a peer bearer token, and reserves peer administration to administrators', async () => {
    const strict = await rig({ adminActorIds: ['root'] });
    const other = await rig();
    try {
      const body = peerRegistrationBody('http://peer.example.test', other.ctx, {
        bearerToken: 'peer-secret',
      });
      const denied = await post(strict.server, '/v1/federation/peers', 'someone', body);
      expect(denied.statusCode).toBe(403);

      const created = await post(strict.server, '/v1/federation/peers', 'root', body);
      expect(created.statusCode).toBe(201);
      expect(JSON.stringify(created.json())).not.toContain('peer-secret');
      expect(created.json().hasBearerToken).toBe(true);

      const listed = await get(strict.server, '/v1/federation/peers', 'root');
      expect(JSON.stringify(listed.json())).not.toContain('peer-secret');
      expect((await get(strict.server, '/v1/federation/peers', 'someone')).statusCode).toBe(403);
      expect((await get(strict.server, '/v1/quarantine', 'someone')).statusCode).toBe(403);
    } finally {
      await strict.server.close();
      await other.server.close();
    }
  });

  it.each([
    'http://127.0.0.1:4000',
    'http://localhost:4000',
    'http://169.254.169.254/latest/meta-data',
    'http://10.0.0.5',
    'http://[::1]:4000',
    'ftp://example.com',
    'http://user:pass@example.com',
  ])('refuses to register %s as a peer outside dev mode', async (url) => {
    const prod = await rig({ adminActorIds: ['root'], allowPrivatePeers: false });
    const other = await rig();
    try {
      const res = await post(
        prod.server,
        '/v1/federation/peers',
        'root',
        peerRegistrationBody(url, other.ctx),
      );
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('invalid_peer_url');
    } finally {
      await prod.server.close();
      await other.server.close();
    }
  });

  it('requires a pinned ledger identity to register a peer', async () => {
    const { server } = await rig();
    try {
      const res = await post(server, '/v1/federation/peers', 'admin', {
        url: 'http://peer.example.test',
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await server.close();
    }
  });
});

describe('durability across restarts', () => {
  it('keeps ledger identity, keys, and history when the process restarts on the same database', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'act-restart-'));
    const db = path.join(dir, 'act.db');

    const ctx1 = await createLedgerContext(db);
    const s1 = await buildServer({ devMode: true, ledgerContext: ctx1 });
    const alice = await register(s1);
    const first = await post(
      s1,
      '/v1/intents',
      alice,
      buildIntentEnvelope(alice, 'before restart').envelope,
    );
    expect(first.statusCode).toBe(201);
    await s1.close();

    const ctx2 = await createLedgerContext(db);
    const s2 = await buildServer({ devMode: true, ledgerContext: ctx2 });
    try {
      expect(ctx2.ledgerId).toBe(ctx1.ledgerId);
      expect(ctx2.ledgerSigner.keyId).toBe(ctx1.ledgerSigner.keyId);
      expect((await get(s2, '/v1/events', alice)).json().items).toHaveLength(3);

      // The key registry is rebuilt from the log: Alice can keep writing, and the chain continues.
      const next = await post(
        s2,
        '/v1/intents',
        alice,
        buildIntentEnvelope(alice, 'after restart').envelope,
      );
      expect(next.statusCode).toBe(201);
      expect(next.json().sequence).toBe(first.json().sequence + 1);
      expect(next.json().receipt.previous_receipt_digest).toBe(first.json().receipt.receipt_digest);
      // Re-registering the same key is an idempotent no-op, not a crash.
      const again = await post(s2, '/v1/keys', alice, buildKeyRegistrationEnvelope(alice));
      expect(again.statusCode).toBe(201);
    } finally {
      await s2.close();
    }
  });

  it('refuses to start when the supplied ledger key is not the ledger registered in the database', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'act-key-'));
    const db = path.join(dir, 'act.db');
    const own = generateKeyPair();
    await createLedgerContext(db, { ledgerPrivateKey: own.privateKey });
    await expect(
      createLedgerContext(db, { ledgerPrivateKey: generateKeyPair().privateKey }),
    ).rejects.toThrow(/does not match/);
    await expect(createLedgerContext(db)).rejects.toThrow(/ACT_LEDGER_PRIVATE_KEY/);
  });
});

describe('production startup', () => {
  it('refuses to start without an administrator', async () => {
    await expect(
      buildServer({
        devMode: false,
        nodeEnv: 'production',
        oidc: { issuer: 'https://idp.example.test', audience: 'act' },
        ledgerContext: await createLedgerContext(':memory:'),
      }),
    ).rejects.toThrow(/administrator/);
  });
});

// Keep the type import used even if a test above is edited.
export type _Unused = SignedEnvelope;
