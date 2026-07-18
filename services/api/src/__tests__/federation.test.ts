import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';
import { generateId } from '@act/core';
import { buildUnsignedEvent } from '@act/sdk';
import { signEnvelope } from '@act/crypto';
import { buildServer } from '../server.js';
import { createLedgerContext } from '../ledger-context.js';
import {
  buildActorRegistrationEnvelope,
  buildArtifactEnvelope,
  buildIntentEnvelope,
  buildKeyRegistrationEnvelope,
  makeActor,
  type TestActor,
} from './helpers.js';

async function listenEphemeral(server: FastifyInstance): Promise<string> {
  await server.listen({ port: 0, host: '127.0.0.1' });
  const addr = server.server.address() as AddressInfo;
  return `http://127.0.0.1:${addr.port}`;
}

async function makeListeningServer(): Promise<{ server: FastifyInstance; url: string }> {
  const server = await buildServer({
    devMode: true,
    ledgerContext: await createLedgerContext(':memory:'),
  });
  const url = await listenEphemeral(server);
  return { server, url };
}

async function registerActorOn(url: string, displayName = 'Federated Actor') {
  const actor = makeActor();
  const keyRes = await fetch(`${url}/v1/keys`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer dev-token` },
    body: JSON.stringify(buildKeyRegistrationEnvelope(actor)),
  });
  expect(keyRes.status).toBe(201);

  const actorRes = await fetch(`${url}/v1/actors`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer dev-token` },
    body: JSON.stringify(buildActorRegistrationEnvelope(actor, displayName)),
  });
  expect(actorRes.status).toBe(201);
  return actor;
}

function buildApprovalDecisionEnvelopeWithFixedPolicy(
  actor: TestActor,
  params: {
    subjectArtifactId: string;
    subjectVersionId: string;
    policyId: string;
    policyVersion: string;
    decision: 'approved' | 'rejected';
    causalParentEventId: string;
  },
) {
  const decision = {
    decision_id: generateId(),
    request_id: generateId(),
    subject: { artifact_id: params.subjectArtifactId, version_id: params.subjectVersionId },
    decision: params.decision,
    scope: 'test-scope',
    reviewer: { actor_id: actor.actorId, key_id: actor.signer.keyId },
    reviewer_authority: { assignment_id: generateId(), role: 'reviewer' },
    policy_id: params.policyId,
    policy_version: params.policyVersion,
    conditions: [],
    comments: 'test',
    issued_at: '2026-07-16T01:00:00Z',
    expires_at: null,
    supersedes: null,
    signature: { key_id: actor.signer.keyId, algorithm: 'ed25519' as const, signature: 'ZmFrZQ==' },
  };
  const artifact = buildArtifactEnvelope({
    actor,
    artifactType: 'ApprovalDecision',
    data: { decision },
  });
  const event = buildUnsignedEvent({
    eventType: 'approval_decided',
    actor: { actorId: actor.actorId, keyId: actor.signer.keyId },
    tenant: 'test-tenant',
    subject: {
      kind: 'attestation',
      artifact_id: artifact.artifact_id as string,
      version_id: artifact.version_id as string,
      artifact_type: 'ApprovalDecision',
    },
    causalParents: [{ event_id: params.causalParentEventId, relation: 'response-to' }],
    payload: artifact,
  });
  return signEnvelope(event, [actor.signer]);
}

describe('federation: real peer-to-peer transport between two independently-hosted ledgers', () => {
  let serverA: FastifyInstance;
  let serverB: FastifyInstance;
  let urlB: string;

  beforeAll(async () => {
    ({ server: serverA } = await makeListeningServer());
    ({ server: serverB, url: urlB } = await makeListeningServer());
  });

  afterAll(async () => {
    await serverA.close();
    await serverB.close();
  });

  it("pulls B's events into A via /v1/federation/pull, trust-bootstrapping B's key from its Key event", async () => {
    const actorB = await registerActorOn(urlB);
    const { envelope } = buildIntentEnvelope(actorB, 'Federated intent from B');
    const submit = await fetch(`${urlB}/v1/intents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer dev-token' },
      body: JSON.stringify(envelope),
    });
    expect(submit.status).toBe(201);

    const peerRes = await serverA.inject({
      method: 'POST',
      url: '/v1/federation/peers',
      headers: { authorization: 'Bearer dev-token' },
      payload: { url: urlB, bearerToken: 'dev-token' },
    });
    expect(peerRes.statusCode).toBe(201);
    const { peerId } = peerRes.json();

    const pullRes = await serverA.inject({
      method: 'POST',
      url: '/v1/federation/pull',
      headers: { authorization: 'Bearer dev-token' },
      payload: { peerId },
    });
    expect(pullRes.statusCode).toBe(200);
    const summary = pullRes.json();
    // key registration + actor registration + intent genesis = 3 events
    expect(summary.accepted).toBeGreaterThanOrEqual(3);
    expect(summary.findings.forks).toEqual([]);
    expect(summary.findings.equivocations).toEqual([]);

    const eventsRes = await serverA.inject({
      method: 'GET',
      url: '/v1/events',
      headers: { authorization: 'Bearer dev-token' },
    });
    const eventIds = eventsRes.json().items.map((e: { eventId: string }) => e.eventId);
    expect(eventIds).toContain(envelope.payloadDigest);
  });

  it('surfaces equivocation as a distinct finding, not a hard reject, when a pulled bundle has conflicting decisions from the same reviewer', async () => {
    const { server: freshA } = await makeListeningServer();
    const { server: freshB, url: freshUrlB } = await makeListeningServer();
    try {
      const reviewer = await registerActorOn(freshUrlB, 'Reviewer');
      const {
        envelope: subjectEnvelope,
        artifactId,
        versionId,
      } = buildIntentEnvelope(reviewer, 'Subject of conflicting decisions');
      await fetch(`${freshUrlB}/v1/intents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer dev-token' },
        body: JSON.stringify(subjectEnvelope),
      });

      const policyId = generateId();
      const policyVersion = `sha-256:${'2'.repeat(64)}`;
      const approve = buildApprovalDecisionEnvelopeWithFixedPolicy(reviewer, {
        subjectArtifactId: artifactId,
        subjectVersionId: versionId,
        policyId,
        policyVersion,
        decision: 'approved',
        causalParentEventId: subjectEnvelope.payloadDigest,
      });
      const reject = buildApprovalDecisionEnvelopeWithFixedPolicy(reviewer, {
        subjectArtifactId: artifactId,
        subjectVersionId: versionId,
        policyId,
        policyVersion,
        decision: 'rejected',
        causalParentEventId: subjectEnvelope.payloadDigest,
      });
      for (const envelope of [approve, reject]) {
        const res = await fetch(`${freshUrlB}/v1/approval-decisions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer dev-token' },
          body: JSON.stringify(envelope),
        });
        expect(res.status).toBe(201);
      }

      const peerRes = await freshA.inject({
        method: 'POST',
        url: '/v1/federation/peers',
        headers: { authorization: 'Bearer dev-token' },
        payload: { url: freshUrlB, bearerToken: 'dev-token' },
      });
      const { peerId } = peerRes.json();

      const pullRes = await freshA.inject({
        method: 'POST',
        url: '/v1/federation/pull',
        headers: { authorization: 'Bearer dev-token' },
        payload: { peerId },
      });
      expect(pullRes.statusCode).toBe(200);
      const summary = pullRes.json();
      // Both conflicting decisions are still ACCEPTED, not quarantined --
      // equivocation is reported, not silently rejected.
      expect(summary.quarantined).toEqual([]);
      expect(summary.findings.equivocations).toHaveLength(1);
      expect(summary.findings.equivocations[0]).toMatchObject({
        keyId: reviewer.signer.keyId,
        subjectArtifactId: artifactId,
        subjectVersionId: versionId,
        decisions: expect.arrayContaining(['approved', 'rejected']),
      });
    } finally {
      await freshA.close();
      await freshB.close();
    }
  });

  it('surfaces a fork as informational when two events name the same parent under a lineage relation', async () => {
    const { server: freshA } = await makeListeningServer();
    const { server: freshB, url: freshUrlB } = await makeListeningServer();
    try {
      const actor = await registerActorOn(freshUrlB, 'Proposer');
      const { envelope: parentEnvelope, artifactId } = buildIntentEnvelope(
        actor,
        'Parent intent with two competing revisions',
      );
      await fetch(`${freshUrlB}/v1/intents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer dev-token' },
        body: JSON.stringify(parentEnvelope),
      });

      for (const suffix of ['A', 'B']) {
        const artifact = buildArtifactEnvelope({
          actor,
          artifactType: 'Intent',
          artifactId,
          data: { statement: `Competing revision ${suffix}`, scope: 'test' },
        });
        const event = buildUnsignedEvent({
          eventType: 'artifact_revised',
          actor: { actorId: actor.actorId, keyId: actor.signer.keyId },
          tenant: 'test-tenant',
          subject: {
            kind: 'artifact',
            artifact_id: artifact.artifact_id as string,
            version_id: artifact.version_id as string,
            artifact_type: 'Intent',
          },
          causalParents: [{ event_id: parentEnvelope.payloadDigest, relation: 'revision-of' }],
          payload: artifact,
        });
        const envelope = signEnvelope(event, [actor.signer]);
        const res = await fetch(`${freshUrlB}/v1/intents`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer dev-token' },
          body: JSON.stringify(envelope),
        });
        expect(res.status).toBe(201);
      }

      const peerRes = await freshA.inject({
        method: 'POST',
        url: '/v1/federation/peers',
        headers: { authorization: 'Bearer dev-token' },
        payload: { url: freshUrlB, bearerToken: 'dev-token' },
      });
      const { peerId } = peerRes.json();

      const pullRes = await freshA.inject({
        method: 'POST',
        url: '/v1/federation/pull',
        headers: { authorization: 'Bearer dev-token' },
        payload: { peerId },
      });
      expect(pullRes.statusCode).toBe(200);
      const summary = pullRes.json();
      expect(summary.findings.forks.length).toBeGreaterThanOrEqual(1);
      expect(summary.findings.forks[0].relation).toBe('revision-of');
      expect(summary.findings.forks[0].childEventIds.length).toBeGreaterThanOrEqual(2);
    } finally {
      await freshA.close();
      await freshB.close();
    }
  });

  it('returns a problem-details 404 pulling from an unregistered peer', async () => {
    const res = await serverA.inject({
      method: 'POST',
      url: '/v1/federation/pull',
      headers: { authorization: 'Bearer dev-token' },
      payload: { peerId: 'does-not-exist' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns a problem-details 502 when the peer is registered but unreachable', async () => {
    const peerRes = await serverA.inject({
      method: 'POST',
      url: '/v1/federation/peers',
      headers: { authorization: 'Bearer dev-token' },
      payload: { url: 'http://127.0.0.1:1', bearerToken: 'dev-token' },
    });
    const { peerId } = peerRes.json();

    const pullRes = await serverA.inject({
      method: 'POST',
      url: '/v1/federation/pull',
      headers: { authorization: 'Bearer dev-token' },
      payload: { peerId },
    });
    expect(pullRes.statusCode).toBe(502);
    expect(pullRes.json().code).toBe('peer_unreachable');

    const pushRes = await serverA.inject({
      method: 'POST',
      url: '/v1/federation/push',
      headers: { authorization: 'Bearer dev-token' },
      payload: { peerId },
    });
    expect(pushRes.statusCode).toBe(502);
    expect(pushRes.json().code).toBe('peer_unreachable');
  });

  it("pushes A's events to B via /v1/federation/push", async () => {
    const { server: freshA, url: freshUrlA } = await makeListeningServer();
    const { server: freshB, url: freshUrlB } = await makeListeningServer();
    try {
      const actor = await registerActorOn(freshUrlA, 'Pusher');
      const { envelope } = buildIntentEnvelope(actor, 'Intent pushed from A to B');
      const submit = await fetch(`${freshUrlA}/v1/intents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer dev-token' },
        body: JSON.stringify(envelope),
      });
      expect(submit.status).toBe(201);

      const peerRes = await freshA.inject({
        method: 'POST',
        url: '/v1/federation/peers',
        headers: { authorization: 'Bearer dev-token' },
        payload: { url: freshUrlB, bearerToken: 'dev-token' },
      });
      const { peerId } = peerRes.json();

      const pushRes = await freshA.inject({
        method: 'POST',
        url: '/v1/federation/push',
        headers: { authorization: 'Bearer dev-token' },
        payload: { peerId },
      });
      expect(pushRes.statusCode).toBe(200);
      expect(pushRes.json().accepted).toBeGreaterThanOrEqual(3);

      const eventsOnB = await fetch(`${freshUrlB}/v1/events`, {
        headers: { authorization: 'Bearer dev-token' },
      });
      const eventsOnBBody = (await eventsOnB.json()) as { items: { eventId: string }[] };
      const eventIdsOnB = eventsOnBBody.items.map((e) => e.eventId);
      expect(eventIdsOnB).toContain(envelope.payloadDigest);
    } finally {
      await freshA.close();
      await freshB.close();
    }
  });

  it('lists and removes registered peers', async () => {
    const registerRes = await serverA.inject({
      method: 'POST',
      url: '/v1/federation/peers',
      headers: { authorization: 'Bearer dev-token' },
      payload: { url: 'http://127.0.0.1:9', label: 'throwaway' },
    });
    const { peerId } = registerRes.json();

    const listRes = await serverA.inject({
      method: 'GET',
      url: '/v1/federation/peers',
      headers: { authorization: 'Bearer dev-token' },
    });
    expect(listRes.json().items.some((p: { peerId: string }) => p.peerId === peerId)).toBe(true);

    const deleteRes = await serverA.inject({
      method: 'DELETE',
      url: `/v1/federation/peers/${peerId}`,
      headers: { authorization: 'Bearer dev-token' },
    });
    expect(deleteRes.statusCode).toBe(200);
  });
});
