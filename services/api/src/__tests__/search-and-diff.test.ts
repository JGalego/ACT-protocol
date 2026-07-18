import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { generateId } from '@act/core';
import { signEnvelope } from '@act/crypto';
import { buildUnsignedEvent } from '@act/sdk';
import { buildServer } from '../server.js';
import { createLedgerContext } from '../ledger-context.js';
import {
  buildArtifactEnvelope,
  buildChallengeEnvelope,
  buildIntentEnvelope,
  buildKeyRegistrationEnvelope,
  makeActor,
  type TestActor,
} from './helpers.js';

async function makeServer(): Promise<FastifyInstance> {
  return buildServer({ devMode: true, ledgerContext: await createLedgerContext(':memory:') });
}

async function registerActor(server: FastifyInstance): Promise<TestActor> {
  const actor = makeActor();
  const response = await server.inject({
    method: 'POST',
    url: '/v1/keys',
    headers: { authorization: `Bearer ${actor.actorId}` },
    payload: buildKeyRegistrationEnvelope(actor),
  });
  expect(response.statusCode).toBe(201);
  return actor;
}

describe('GET /v1/events search/filter', () => {
  let server: FastifyInstance;
  let actor: TestActor;

  beforeEach(async () => {
    server = await makeServer();
    actor = await registerActor(server);
  });

  afterEach(async () => {
    await server.close();
  });

  it('filters by eventType', async () => {
    const intent = buildIntentEnvelope(actor, 'ship the thing');
    await server.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: { authorization: `Bearer ${actor.actorId}` },
      payload: intent.envelope,
    });

    const genesisFirstEvent = await server.inject({
      method: 'GET',
      url: '/v1/events',
      headers: { authorization: `Bearer ${actor.actorId}` },
    });
    const allEventIds = genesisFirstEvent.json().items.map((e: { event_id: string }) => e.event_id);
    expect(allEventIds.length).toBeGreaterThanOrEqual(2); // key registration + intent genesis

    const filtered = await server.inject({
      method: 'GET',
      url: '/v1/events?eventType=genesis',
      headers: { authorization: `Bearer ${actor.actorId}` },
    });
    expect(filtered.statusCode).toBe(200);
    const items = filtered.json().items as { eventType: string }[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((e) => e.eventType === 'genesis')).toBe(true);
  });

  it('filters by subjectKind', async () => {
    const disputed = buildIntentEnvelope(actor, 'disputed statement');
    const disputedResponse = await server.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: { authorization: `Bearer ${actor.actorId}` },
      payload: disputed.envelope,
    });
    expect(disputedResponse.statusCode).toBe(201);

    await server.inject({
      method: 'POST',
      url: '/v1/challenges',
      headers: { authorization: `Bearer ${actor.actorId}` },
      payload: buildChallengeEnvelope(actor, disputed.envelope.payloadDigest),
    });

    const response = await server.inject({
      method: 'GET',
      url: '/v1/events?subjectKind=attestation',
      headers: { authorization: `Bearer ${actor.actorId}` },
    });
    expect(response.statusCode).toBe(200);
    const items = response.json().items as { subjectKind: string }[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((e) => e.subjectKind === 'attestation')).toBe(true);
  });
});

describe('GET /v1/challenges', () => {
  let server: FastifyInstance;
  let actor: TestActor;

  beforeEach(async () => {
    server = await makeServer();
    actor = await registerActor(server);
  });

  afterEach(async () => {
    await server.close();
  });

  it('lists only challenge_raised/challenge_resolved events', async () => {
    const intent = buildIntentEnvelope(actor, 'a claim someone will dispute');
    const intentResponse = await server.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: { authorization: `Bearer ${actor.actorId}` },
      payload: intent.envelope,
    });
    expect(intentResponse.statusCode).toBe(201);

    const challengeResponse = await server.inject({
      method: 'POST',
      url: '/v1/challenges',
      headers: { authorization: `Bearer ${actor.actorId}` },
      payload: buildChallengeEnvelope(actor, intent.envelope.payloadDigest),
    });
    expect(challengeResponse.statusCode).toBe(201);

    const response = await server.inject({
      method: 'GET',
      url: '/v1/challenges',
      headers: { authorization: `Bearer ${actor.actorId}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: { eventType: string }[]; nextCursor: string | null };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.eventType).toBe('challenge_raised');
  });

  it('returns an empty list when no challenges have been raised', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/v1/challenges',
      headers: { authorization: `Bearer ${actor.actorId}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([]);
  });
});

describe('GET /v1/artifacts/:id/diff', () => {
  let server: FastifyInstance;
  let actor: TestActor;

  beforeEach(async () => {
    server = await makeServer();
    actor = await registerActor(server);
  });

  afterEach(async () => {
    await server.close();
  });

  function buildTwoVersions(actor: TestActor) {
    const artifactId = generateId();
    const v1 = buildArtifactEnvelope({
      actor,
      artifactType: 'Task',
      artifactId,
      data: { title: 'Draft the doc', description: 'first pass', status: 'open' },
    });
    const genesisEvent = buildUnsignedEvent({
      eventType: 'genesis',
      actor: { actorId: actor.actorId, keyId: actor.signer.keyId },
      tenant: 'test-tenant',
      subject: {
        kind: 'artifact',
        artifact_id: artifactId,
        version_id: v1.version_id as string,
        artifact_type: 'Task',
      },
      payload: v1,
    });
    const genesisEnvelope = signEnvelope(genesisEvent, [actor.signer]);

    const v2 = buildArtifactEnvelope({
      actor,
      artifactType: 'Task',
      artifactId,
      data: { title: 'Draft the doc', description: 'second pass', status: 'done' },
      lineage: [{ relation: 'revises', target_version_id: v1.version_id as string }],
    });
    const revisionEvent = buildUnsignedEvent({
      eventType: 'artifact_revised',
      actor: { actorId: actor.actorId, keyId: actor.signer.keyId },
      tenant: 'test-tenant',
      subject: {
        kind: 'artifact',
        artifact_id: artifactId,
        version_id: v2.version_id as string,
        artifact_type: 'Task',
      },
      causalParents: [{ event_id: genesisEnvelope.payloadDigest, relation: 'revision-of' }],
      payload: v2,
    });
    const revisionEnvelope = signEnvelope(revisionEvent, [actor.signer]);

    return {
      artifactId,
      fromVersionId: v1.version_id as string,
      toVersionId: v2.version_id as string,
      genesisEnvelope,
      revisionEnvelope,
    };
  }

  it('reports the changed fields between two versions', async () => {
    const { artifactId, fromVersionId, toVersionId, genesisEnvelope, revisionEnvelope } =
      buildTwoVersions(actor);

    const genesisResponse = await server.inject({
      method: 'POST',
      url: '/v1/artifacts',
      headers: { authorization: `Bearer ${actor.actorId}` },
      payload: genesisEnvelope,
    });
    expect(genesisResponse.statusCode).toBe(201);
    const revisionResponse = await server.inject({
      method: 'POST',
      url: '/v1/artifacts',
      headers: { authorization: `Bearer ${actor.actorId}` },
      payload: revisionEnvelope,
    });
    expect(revisionResponse.statusCode).toBe(201);

    const response = await server.inject({
      method: 'GET',
      url: `/v1/artifacts/${artifactId}/diff?from=${encodeURIComponent(fromVersionId)}&to=${encodeURIComponent(toVersionId)}`,
      headers: { authorization: `Bearer ${actor.actorId}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      diff: { path: string; type: string; before?: unknown; after?: unknown }[];
    };
    expect(body.diff).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '$.data.description',
          type: 'changed',
          before: 'first pass',
          after: 'second pass',
        }),
        expect.objectContaining({
          path: '$.data.status',
          type: 'changed',
          before: 'open',
          after: 'done',
        }),
      ]),
    );
  });

  it('returns 400 when "from" or "to" is missing', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/v1/artifacts/${generateId()}/diff?from=x`,
      headers: { authorization: `Bearer ${actor.actorId}` },
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns 404 when a version id does not exist for the artifact', async () => {
    const { artifactId, fromVersionId, genesisEnvelope } = buildTwoVersions(actor);
    const genesisResponse = await server.inject({
      method: 'POST',
      url: '/v1/artifacts',
      headers: { authorization: `Bearer ${actor.actorId}` },
      payload: genesisEnvelope,
    });
    expect(genesisResponse.statusCode).toBe(201);

    const response = await server.inject({
      method: 'GET',
      url: `/v1/artifacts/${artifactId}/diff?from=${encodeURIComponent(fromVersionId)}&to=sha-256:${'0'.repeat(64)}`,
      headers: { authorization: `Bearer ${actor.actorId}` },
    });
    expect(response.statusCode).toBe(404);
  });
});
