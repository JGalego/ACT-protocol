import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { signEnvelope } from '@act/crypto';
import { buildUnsignedEvent } from '@act/sdk';
import { buildServer } from '../server.js';
import { createLedgerContext } from '../ledger-context.js';
import {
  buildActorRegistrationEnvelope,
  buildApprovalDecisionEnvelope,
  buildApprovalRequestEnvelope,
  buildChallengeEnvelope,
  buildIntentEnvelope,
  buildKeyRegistrationEnvelope,
  buildPolicyEnvelope,
  buildVerificationEnvelope,
  makeActor,
} from './helpers.js';

async function makeServer(): Promise<FastifyInstance> {
  return buildServer({ devMode: true, ledgerContext: await createLedgerContext(':memory:') });
}

async function registerActor(server: FastifyInstance, displayName = 'Test Actor') {
  const actor = makeActor();
  const keyResponse = await server.inject({
    method: 'POST',
    url: '/v1/keys',
    headers: { authorization: `Bearer ${actor.actorId}` },
    payload: buildKeyRegistrationEnvelope(actor),
  });
  expect(keyResponse.statusCode).toBe(201);

  const actorResponse = await server.inject({
    method: 'POST',
    url: '/v1/actors',
    headers: { authorization: `Bearer ${actor.actorId}` },
    payload: buildActorRegistrationEnvelope(actor, displayName),
  });
  expect(actorResponse.statusCode).toBe(201);
  return actor;
}

describe('ACT API service', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await makeServer();
  });

  afterEach(async () => {
    await server.close();
  });

  it('answers liveness and readiness without authentication', async () => {
    const live = await server.inject({ method: 'GET', url: '/v1/health/live' });
    expect(live.statusCode).toBe(200);
    const ready = await server.inject({ method: 'GET', url: '/v1/health/ready' });
    expect(ready.statusCode).toBe(200);
  });

  it('rejects a request with no Authorization header', async () => {
    const response = await server.inject({ method: 'GET', url: '/v1/artifacts/x' });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('unauthorized');
  });

  it('registers a key via proof of possession, then an actor referencing it', async () => {
    const actor = await registerActor(server);
    expect(actor.actorId).toBeTruthy();
  });

  it('rejects key registration when the embedded public key does not match the signature', async () => {
    const actor = makeActor();
    const forged = makeActor();
    const envelope = buildKeyRegistrationEnvelope(actor);
    (envelope.payload.payload as any).data.public_key = forged.signer.publicKey;
    const response = await server.inject({
      method: 'POST',
      url: '/v1/keys',
      headers: { authorization: `Bearer ${actor.actorId}` },
      payload: envelope,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('proof_of_possession_failed');
  });

  it('rejects an actor registration from an unregistered key', async () => {
    const actor = makeActor();
    const response = await server.inject({
      method: 'POST',
      url: '/v1/actors',
      headers: { authorization: `Bearer ${actor.actorId}` },
      payload: buildActorRegistrationEnvelope(actor, 'Nobody'),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('unknown_signing_key');
  });

  it('rejects a write from a key the ledger has never seen (cannot even verify its signature)', async () => {
    // Per ACT-1.0.md section 6.1, signature verification (step 3) precedes
    // trust-policy evaluation (step 4). An entirely unregistered key has no
    // known public key to check the signature against, so this is reported
    // as an invalid-signature finding rather than an untrusted-actor one --
    // see packages/ledger's own tests for the distinct untrusted_actor path
    // (a registered-but-not-yet-trusted key).
    const actor = makeActor();
    const { envelope } = buildIntentEnvelope(actor, 'Some intent');
    const response = await server.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: { authorization: `Bearer ${actor.actorId}` },
      payload: envelope,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('invalid_signature');
  });

  it('accepts an Intent from a registered actor and makes it readable', async () => {
    const actor = await registerActor(server);
    const { envelope, artifactId } = buildIntentEnvelope(
      actor,
      'Ship the ACT reference implementation.',
    );

    const submit = await server.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: { authorization: `Bearer ${actor.actorId}` },
      payload: envelope,
    });
    expect(submit.statusCode).toBe(201);
    expect(submit.json().duplicate).toBe(false);

    const getResponse = await server.inject({
      method: 'GET',
      url: `/v1/artifacts/${artifactId}`,
      headers: { authorization: `Bearer ${actor.actorId}` },
    });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json().currentVersionId).toBe((envelope.payload as any).subject.version_id);
  });

  it('is idempotent when the identical signed envelope is resubmitted', async () => {
    const actor = await registerActor(server);
    const { envelope } = buildIntentEnvelope(actor, 'Idempotency check.');
    const first = await server.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: { authorization: `Bearer ${actor.actorId}` },
      payload: envelope,
    });
    const second = await server.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: { authorization: `Bearer ${actor.actorId}` },
      payload: envelope,
    });
    expect(first.json().duplicate).toBe(false);
    expect(second.json().duplicate).toBe(true);
    expect(second.json().eventId).toBe(first.json().eventId);
  });

  it('rejects an intent submission missing a required field (schema validation)', async () => {
    const actor = await registerActor(server);
    const { envelope } = buildIntentEnvelope(actor, 'x');
    delete (envelope.payload.payload as any).data.scope;
    const response = await server.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: { authorization: `Bearer ${actor.actorId}` },
      payload: envelope,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('artifact_payload_invalid');
  });

  it('records a two-input transformation and exposes its lineage', async () => {
    const actor = await registerActor(server);
    const { envelope: intentA, versionId: versionA } = buildIntentEnvelope(actor, 'Input A');
    const { envelope: intentB, versionId: versionB } = buildIntentEnvelope(actor, 'Input B');
    await server.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: { authorization: `Bearer ${actor.actorId}` },
      payload: intentA,
    });
    await server.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: { authorization: `Bearer ${actor.actorId}` },
      payload: intentB,
    });

    const transformationPayload = {
      transformation_id: `sha-256:${'1'.repeat(64)}`,
      mode: 'discovery',
      actor: { actor_id: actor.actorId, key_id: actor.signer.keyId },
      inputs: [versionA, versionB],
      outputs: [`sha-256:${'2'.repeat(64)}`],
      semantic_change_claim: {
        classification: 'alternative-proposal',
        assessor: { actor_id: actor.actorId, key_id: actor.signer.keyId },
      },
      assumptions: [],
      ambiguities: [],
      alternatives: [],
      rationale: 'Merged two candidate intents into a proposal.',
      confidence_assessments: [],
      uncertainties: [],
      evidence: [],
      verification_results: [],
      applicable_policy: { not_applicable: true, reason: 'test' },
      approval_requirement: { required: false, reason: 'test' },
    };
    const event = buildUnsignedEvent({
      eventType: 'transformation_recorded',
      actor: { actorId: actor.actorId, keyId: actor.signer.keyId },
      tenant: 'test-tenant',
      subject: { kind: 'transformation' },
      causalParents: [
        { event_id: intentA.payloadDigest, relation: 'input' },
        { event_id: intentB.payloadDigest, relation: 'input' },
      ],
      payload: transformationPayload,
    });
    const transformationEnvelope = signEnvelope(event, [actor.signer]);
    const submit = await server.inject({
      method: 'POST',
      url: '/v1/transformations',
      headers: { authorization: `Bearer ${actor.actorId}` },
      payload: transformationEnvelope,
    });
    expect(submit.statusCode).toBe(201);

    const lineageResponse = await server.inject({
      method: 'GET',
      url: `/v1/lineage/${submit.json().eventId}`,
      headers: { authorization: `Bearer ${actor.actorId}` },
    });
    expect(lineageResponse.statusCode).toBe(200);
    const ancestorIds = lineageResponse
      .json()
      .lineage.ancestors.map((e: any) => e.eventId)
      .sort();
    expect(ancestorIds).toEqual([intentA.payloadDigest, intentB.payloadDigest].sort());
  });

  it('lists accepted events with cursor pagination', async () => {
    const actor = await registerActor(server);
    for (let i = 0; i < 3; i++) {
      const { envelope } = buildIntentEnvelope(actor, `Intent ${i}`);
      await server.inject({
        method: 'POST',
        url: '/v1/intents',
        headers: { authorization: `Bearer ${actor.actorId}` },
        payload: envelope,
      });
    }
    const page1 = await server.inject({
      method: 'GET',
      url: '/v1/events?limit=2',
      headers: { authorization: `Bearer ${actor.actorId}` },
    });
    const body1 = page1.json();
    expect(body1.items).toHaveLength(2);
    expect(body1.nextCursor).not.toBeNull();

    const page2 = await server.inject({
      method: 'GET',
      url: `/v1/events?limit=2&cursor=${body1.nextCursor}`,
      headers: { authorization: `Bearer ${actor.actorId}` },
    });
    expect(page2.json().items.length).toBeGreaterThan(0);
  });

  it('exports a bundle and imports it into a fresh ledger', async () => {
    const actor = await registerActor(server);
    const { envelope } = buildIntentEnvelope(actor, 'Federated intent');
    await server.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: { authorization: `Bearer ${actor.actorId}` },
      payload: envelope,
    });

    const exportResponse = await server.inject({
      method: 'POST',
      url: '/v1/bundles/export',
      headers: { authorization: `Bearer ${actor.actorId}` },
      payload: {},
    });
    expect(exportResponse.statusCode).toBe(200);
    const bundle = exportResponse.json();
    expect(bundle.events.length).toBeGreaterThanOrEqual(3); // key + actor + intent genesis

    const secondServer = await makeServer();
    try {
      const importResponse = await secondServer.inject({
        method: 'POST',
        url: '/v1/bundles/import',
        headers: { authorization: `Bearer ${actor.actorId}` },
        payload: bundle,
      });
      expect(importResponse.statusCode).toBe(200);
      expect(importResponse.json().accepted).toBeGreaterThanOrEqual(3);
    } finally {
      await secondServer.close();
    }
  });

  it('refuses to build a production-mode server without OIDC configured', async () => {
    await expect(
      buildServer({
        devMode: false,
        nodeEnv: 'production',
        ledgerContext: await createLedgerContext(':memory:'),
      }),
    ).rejects.toThrow();
  });

  it('returns a problem-details 404 for an unknown artifact id', async () => {
    const actor = await registerActor(server);
    const response = await server.inject({
      method: 'GET',
      url: '/v1/artifacts/does-not-exist',
      headers: { authorization: `Bearer ${actor.actorId}` },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('not_found');
  });

  it('returns a problem-details 404 for lineage on an unknown event id', async () => {
    const actor = await registerActor(server);
    const response = await server.inject({
      method: 'GET',
      url: `/v1/lineage/sha-256:${'0'.repeat(64)}`,
      headers: { authorization: `Bearer ${actor.actorId}` },
    });
    expect(response.statusCode).toBe(404);
  });

  it('lists the empty version history for an artifact with no events', async () => {
    const actor = await registerActor(server);
    const response = await server.inject({
      method: 'GET',
      url: '/v1/artifacts/does-not-exist/versions',
      headers: { authorization: `Bearer ${actor.actorId}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([]);
  });

  it('exposes the schema id catalogue', async () => {
    const response = await server.inject({ method: 'GET', url: '/v1/schemas' });
    expect(response.statusCode).toBe(200);
    expect(response.json().schemaIds.unsignedEvent).toContain('unsigned-event.schema.json');
  });

  it('rejects key registration with a payload that is not a Key artifact', async () => {
    const actor = makeActor();
    const envelope = buildKeyRegistrationEnvelope(actor);
    (envelope.payload.payload as any).artifact_type = 'Task';
    const response = await server.inject({
      method: 'POST',
      url: '/v1/keys',
      headers: { authorization: `Bearer ${actor.actorId}` },
      payload: envelope,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('invalid_key_payload');
  });

  it('rejects key registration when actor.key_id does not match the Key record', async () => {
    const actor = makeActor();
    const envelope = buildKeyRegistrationEnvelope(actor);
    (envelope.payload.payload as any).data.key_id = 'ed25519:' + 'f'.repeat(16);
    const response = await server.inject({
      method: 'POST',
      url: '/v1/keys',
      headers: { authorization: `Bearer ${actor.actorId}` },
      payload: envelope,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('key_id_mismatch');
  });

  it('runs a full approval workflow: request, decision, and challenge, then records a verification', async () => {
    const actor = await registerActor(server);
    const {
      envelope: intentEnvelope,
      artifactId,
      versionId,
    } = buildIntentEnvelope(actor, 'Needs approval');
    const intentSubmit = await server.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: { authorization: `Bearer ${actor.actorId}` },
      payload: intentEnvelope,
    });
    const intentEventId = intentSubmit.json().eventId;

    const { envelope: requestEnvelope, requestId } = buildApprovalRequestEnvelope(
      actor,
      artifactId,
      versionId,
      intentEventId,
    );
    const requestSubmit = await server.inject({
      method: 'POST',
      url: '/v1/approval-requests',
      headers: { authorization: `Bearer ${actor.actorId}` },
      payload: requestEnvelope,
    });
    expect(requestSubmit.statusCode).toBe(201);

    const decisionEnvelope = buildApprovalDecisionEnvelope(
      actor,
      requestId,
      artifactId,
      versionId,
      requestSubmit.json().eventId,
    );
    const decisionSubmit = await server.inject({
      method: 'POST',
      url: '/v1/approval-decisions',
      headers: { authorization: `Bearer ${actor.actorId}` },
      payload: decisionEnvelope,
    });
    expect(decisionSubmit.statusCode).toBe(201);

    const approvalGet = await server.inject({
      method: 'GET',
      url: `/v1/approvals/${decisionSubmit.json().eventId}`,
      headers: { authorization: `Bearer ${actor.actorId}` },
    });
    expect(approvalGet.statusCode).toBe(200);
    expect(approvalGet.json().event.eventId).toBe(decisionSubmit.json().eventId);

    const challengeEnvelope = buildChallengeEnvelope(actor, intentEventId);
    const challengeSubmit = await server.inject({
      method: 'POST',
      url: '/v1/challenges',
      headers: { authorization: `Bearer ${actor.actorId}` },
      payload: challengeEnvelope,
    });
    expect(challengeSubmit.statusCode).toBe(201);

    const verificationEnvelope = buildVerificationEnvelope(actor, intentEventId);
    const verificationSubmit = await server.inject({
      method: 'POST',
      url: '/v1/verifications',
      headers: { authorization: `Bearer ${actor.actorId}` },
      payload: verificationEnvelope,
    });
    expect(verificationSubmit.statusCode).toBe(201);

    const verificationGet = await server.inject({
      method: 'GET',
      url: `/v1/verifications/${verificationSubmit.json().eventId}`,
      headers: { authorization: `Bearer ${actor.actorId}` },
    });
    expect(verificationGet.statusCode).toBe(200);

    const policyEnvelope = buildPolicyEnvelope(actor, intentEventId);
    const policySubmit = await server.inject({
      method: 'POST',
      url: '/v1/policies',
      headers: { authorization: `Bearer ${actor.actorId}` },
      payload: policyEnvelope,
    });
    expect(policySubmit.statusCode).toBe(201);
  });

  it('lists quarantined events after a bad import', async () => {
    const actor = await registerActor(server);
    const { envelope } = buildIntentEnvelope(actor, 'Will be tampered');
    const tampered = {
      ...envelope,
      payload: {
        ...envelope.payload,
        payload: { ...(envelope.payload as any).payload, data: { statement: 'x', scope: 'y' } },
      },
    };
    await server.inject({
      method: 'POST',
      url: '/v1/bundles/import',
      headers: { authorization: `Bearer ${actor.actorId}` },
      payload: {
        bundle_id: `sha-256:${'6'.repeat(64)}`,
        source_ledger_id: actor.actorId,
        exported_at: '2026-07-16T00:00:00Z',
        events: [
          {
            signed_envelope: tampered,
            source_receipt: {
              ledger_id: actor.actorId,
              sequence: 0,
              event_id: tampered.payloadDigest,
              accepted_at: '2026-07-16T00:00:00Z',
              previous_receipt_digest: `sha-256:${'0'.repeat(64)}`,
              receipt_digest: `sha-256:${'1'.repeat(64)}`,
              signature: {
                key_id: actor.signer.keyId,
                algorithm: 'ed25519',
                signature: 'ZmFrZQ==',
              },
            },
          },
        ],
        completeness: { scope: 'complete', known_gaps: [] },
        signature: { key_id: 'x', algorithm: 'ed25519', signature: 'ZmFrZQ==' },
      },
    });
    const quarantineList = await server.inject({
      method: 'GET',
      url: '/v1/quarantine',
      headers: { authorization: `Bearer ${actor.actorId}` },
    });
    expect(quarantineList.statusCode).toBe(200);
    expect(quarantineList.json().items.length).toBeGreaterThan(0);
  });

  it('rejects an import bundle that fails its own schema validation', async () => {
    const actor = await registerActor(server);
    const response = await server.inject({
      method: 'POST',
      url: '/v1/bundles/import',
      headers: { authorization: `Bearer ${actor.actorId}` },
      payload: { not: 'a bundle' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('schema_invalid');
  });

  it('rejects a request when the bearer token is present but empty', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/v1/artifacts/x',
      headers: { authorization: 'Bearer ' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a request with a malformed Authorization header', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/v1/artifacts/x',
      headers: { authorization: 'Basic abc123' },
    });
    expect(response.statusCode).toBe(401);
  });
});
