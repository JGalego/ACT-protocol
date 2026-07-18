import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildApprovalDecisionEnvelope,
  buildApprovalRequestEnvelope,
  buildGenesisArtifact,
  buildPolicyEnvelope,
  buildTransformationEnvelope,
  makeListeningServer,
  postEnvelope,
  registerActorOn,
  type Actor,
} from '../shared/fixtures.js';

/**
 * An open-source collaboration with external contributions and signed
 * bundle federation -- PROMPT.md's Example Applications item #5. An
 * external contributor works entirely on their own independently-hosted
 * ledger (never sharing a database with upstream); the maintainer's
 * upstream ledger pulls the contribution over real HTTP
 * (POST /v1/federation/pull), trust-bootstrapping the contributor's key
 * from their own Key event in the pulled bundle, then reviews and merges
 * it through the normal approval flow.
 */
describe('example: open-source federation with an external contribution', () => {
  let upstream: FastifyInstance;
  let upstreamUrl: string;
  let fork: FastifyInstance;
  let forkUrl: string;
  let maintainer: Actor;
  let contributor: Actor;

  beforeAll(async () => {
    ({ server: upstream, url: upstreamUrl } = await makeListeningServer());
    ({ server: fork, url: forkUrl } = await makeListeningServer());
    maintainer = await registerActorOn(upstreamUrl, 'Upstream Maintainer');
    // The contributor exists ONLY on their own fork -- upstream has never seen this key.
    contributor = await registerActorOn(forkUrl, 'External Contributor');
  });

  afterAll(async () => {
    await upstream.close();
    await fork.close();
  });

  it("pulls an external contributor's signed work from their own ledger and merges it upstream", async () => {
    // The contributor records their work entirely on the fork.
    const intent = buildGenesisArtifact({
      actor: contributor,
      artifactType: 'Intent',
      data: { statement: 'Fix a race condition in the connection pool.', scope: 'packages/ledger' },
    });
    expect(
      (await postEnvelope(forkUrl, '/v1/intents', intent.envelope, contributor.actorId)).status,
    ).toBe(201);

    const patch = buildGenesisArtifact({
      actor: contributor,
      artifactType: 'Task',
      data: {
        title: 'Fix connection pool race condition',
        description: 'Adds a mutex around pool acquisition.',
        status: 'done',
      },
    });
    expect(
      (await postEnvelope(forkUrl, '/v1/artifacts', patch.envelope, contributor.actorId)).status,
    ).toBe(201);

    const transformation = buildTransformationEnvelope({
      actor: contributor,
      subjectArtifactId: patch.artifactId,
      inputs: [intent.eventId],
      outputs: [patch.eventId],
      classification: 'semantic-modification',
      rationale: 'Fixes a real concurrency bug in the pool.',
      causalParents: [{ event_id: intent.eventId, relation: 'input' }],
      approvalRequired: true,
      approvalReason: 'external contributions require maintainer review',
    });
    expect(
      (
        await postEnvelope(
          forkUrl,
          '/v1/transformations',
          transformation.envelope,
          contributor.actorId,
        )
      ).status,
    ).toBe(201);

    // The maintainer registers the fork as a federation peer and pulls it.
    const peerResponse = await postEnvelope(
      upstreamUrl,
      '/v1/federation/peers',
      { url: forkUrl, bearerToken: 'upstream-federation-puller' },
      maintainer.actorId,
    );
    expect(peerResponse.status).toBe(201);
    const { peerId } = (await peerResponse.json()) as { peerId: string };

    const pullResponse = await postEnvelope(
      upstreamUrl,
      '/v1/federation/pull',
      { peerId },
      maintainer.actorId,
    );
    expect(pullResponse.status).toBe(200);
    const pullResult = (await pullResponse.json()) as {
      accepted: number;
      findings: { forks: unknown[]; equivocations: unknown[] };
    };
    expect(pullResult.accepted).toBeGreaterThanOrEqual(4); // contributor's key + actor + intent + task + transformation
    // A clean external contribution is neither a fork nor equivocation --
    // both finding classes exist precisely so a real one would be reported,
    // not silently rejected (spec/federation.md section 6).
    expect(pullResult.findings.forks).toEqual([]);
    expect(pullResult.findings.equivocations).toEqual([]);

    // The contributor's key was trust-bootstrapped on upstream purely from
    // the pulled Key event -- proven by upstream now accepting a NEW,
    // independently-submitted event signed by that same key.
    const followUpTask = buildGenesisArtifact({
      actor: contributor,
      artifactType: 'Task',
      data: {
        title: 'Add a regression test for the race condition',
        description: 'Covers concurrent pool acquisition.',
        status: 'done',
      },
    });
    const followUpResponse = await postEnvelope(
      upstreamUrl,
      '/v1/artifacts',
      followUpTask.envelope,
      contributor.actorId,
    );
    expect(followUpResponse.status).toBe(201);

    // The maintainer reviews and merges (approves) the original contribution upstream.
    const policy = buildPolicyEnvelope({
      actor: maintainer,
      causalParentEventId: transformation.eventId,
      quorum: 1,
    });
    expect(
      (await postEnvelope(upstreamUrl, '/v1/policies', policy.envelope, maintainer.actorId)).status,
    ).toBe(201);

    const approvalRequest = buildApprovalRequestEnvelope({
      actor: maintainer,
      subjectArtifactId: patch.artifactId,
      subjectVersionId: patch.versionId,
      causalParentEventId: transformation.eventId,
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
    });
    expect(
      (
        await postEnvelope(
          upstreamUrl,
          '/v1/approval-requests',
          approvalRequest.envelope,
          maintainer.actorId,
        )
      ).status,
    ).toBe(201);

    const approvalDecision = buildApprovalDecisionEnvelope({
      actor: maintainer,
      requestId: approvalRequest.requestId,
      subjectArtifactId: patch.artifactId,
      subjectVersionId: patch.versionId,
      causalParentEventId: approvalRequest.eventId,
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
      decision: 'approved',
    });
    expect(
      (
        await postEnvelope(
          upstreamUrl,
          '/v1/approval-decisions',
          approvalDecision.envelope,
          maintainer.actorId,
        )
      ).status,
    ).toBe(201);

    // Assertion proving the expected outcome: upstream's own history for
    // the contributed artifact now includes the contributor's original
    // genesis event alongside the maintainer's approval.
    const versionsResponse = await fetch(
      `${upstreamUrl}/v1/artifacts/${patch.artifactId}/versions`,
      {
        headers: { authorization: `Bearer ${maintainer.actorId}` },
      },
    );
    const versions = (await versionsResponse.json()) as { items: { eventId: string }[] };
    expect(versions.items.some((e) => e.eventId === patch.eventId)).toBe(true);
  });
});
