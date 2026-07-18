import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildApprovalDecisionEnvelope,
  buildApprovalRequestEnvelope,
  buildChallengeEnvelope,
  buildChallengeResolutionEnvelope,
  buildGenesisArtifact,
  buildPolicyEnvelope,
  buildTransformationEnvelope,
  buildVerificationEnvelope,
  makeListeningServer,
  postEnvelope,
  registerActorOn,
  type Actor,
} from '../shared/fixtures.js';

interface ChallengeRecord {
  sequence: number;
  subjectArtifactId: string | null;
  envelope: {
    payload: { payload: { data: { challenge: { disputed_claim: string; status: string } } } };
  };
}

/**
 * A safety-critical workflow with strict separation of duties, formal
 * evidence, and an unresolved challenge that prevents release --
 * PROMPT.md's Example Applications item #6. The ACT ledger itself never
 * refuses to record a fact (an append-only record, not a gatekeeper), so
 * "blocks release" here means what it means in practice: a
 * release-readiness check -- the kind real release tooling would run --
 * correctly reports NOT READY while a challenge against the approval
 * remains status "open" (schemas/challenge/challenge.schema.json), and
 * READY only once a real challenge_resolved event changes its status.
 * This check is written here, not as a library function, because it is
 * business policy specific to this example, not a protocol invariant.
 */
function assessReleaseReadiness(
  approvalDecisionEventId: string,
  challenges: ChallengeRecord[],
): { ready: boolean; reason: string } {
  // Events are immutable: a resolved challenge's original challenge_raised
  // record still says status "open" forever. Only the LATEST event per
  // challenge artifact_id reflects its current status, so this groups by
  // artifact and takes the highest-sequence (most recent) record before
  // checking status -- exactly what real release tooling reading this
  // ledger would have to do.
  const latestByArtifact = new Map<string, ChallengeRecord>();
  for (const c of challenges) {
    if (!c.subjectArtifactId) continue;
    const current = latestByArtifact.get(c.subjectArtifactId);
    if (!current || c.sequence > current.sequence) latestByArtifact.set(c.subjectArtifactId, c);
  }

  const openChallenge = [...latestByArtifact.values()].find(
    (c) =>
      c.envelope.payload.payload.data.challenge.disputed_claim === approvalDecisionEventId &&
      c.envelope.payload.payload.data.challenge.status === 'open',
  );
  if (openChallenge) {
    return { ready: false, reason: 'an open challenge disputes the release approval' };
  }
  return { ready: true, reason: 'no open challenge disputes the release approval' };
}

async function fetchChallenges(url: string, bearerToken: string): Promise<ChallengeRecord[]> {
  const response = await fetch(`${url}/v1/challenges`, {
    headers: { authorization: `Bearer ${bearerToken}` },
  });
  return ((await response.json()) as { items: ChallengeRecord[] }).items;
}

describe('example: safety-critical workflow with an unresolved challenge', () => {
  let server: FastifyInstance;
  let url: string;
  let implementer: Actor;
  let approver: Actor;
  let safetyAuditor: Actor;

  beforeAll(async () => {
    ({ server, url } = await makeListeningServer());
    implementer = await registerActorOn(url, 'Firmware Engineer');
    approver = await registerActorOn(url, 'Independent Safety Approver');
    safetyAuditor = await registerActorOn(url, 'Safety Auditor');
  });

  afterAll(async () => {
    await server.close();
  });

  it('blocks release readiness while a challenge against the approval remains open, and clears once resolved', async () => {
    const intent = buildGenesisArtifact({
      actor: implementer,
      artifactType: 'Intent',
      data: {
        statement: 'Adjust braking-control firmware response timing for the new sensor.',
        scope: 'firmware/braking',
      },
    });
    expect(
      (await postEnvelope(url, '/v1/intents', intent.envelope, implementer.actorId)).status,
    ).toBe(201);

    const change = buildGenesisArtifact({
      actor: implementer,
      artifactType: 'Task',
      data: {
        title: 'Adjust braking response timing',
        description: 'Reduces response latency by 8ms for the new sensor.',
        status: 'done',
      },
    });
    expect(
      (await postEnvelope(url, '/v1/artifacts', change.envelope, implementer.actorId)).status,
    ).toBe(201);

    // Formal evidence: a formally-verified (model-checked) timing proof, not just a manual review.
    const formalVerification = buildVerificationEnvelope({
      actor: approver,
      subjectEventId: change.eventId,
      method: 'formal-proof',
      result: 'pass',
      limitations:
        'Model-checked against the documented timing envelope; does not cover sensor hardware faults.',
    });
    expect(
      (await postEnvelope(url, '/v1/verifications', formalVerification.envelope, approver.actorId))
        .status,
    ).toBe(201);

    const transformation = buildTransformationEnvelope({
      actor: implementer,
      subjectArtifactId: change.artifactId,
      inputs: [intent.eventId],
      outputs: [change.eventId],
      classification: 'semantic-modification',
      rationale: 'Safety-critical timing change, formally verified.',
      causalParents: [
        { event_id: intent.eventId, relation: 'input' },
        { event_id: formalVerification.eventId, relation: 'input' },
      ],
      approvalRequired: true,
      approvalReason:
        'safety-critical changes require an independent approver, separate from the implementer',
    });
    expect(
      (await postEnvelope(url, '/v1/transformations', transformation.envelope, implementer.actorId))
        .status,
    ).toBe(201);

    // Strict separation of duties: the approver role is distinct from, and excludes, the implementer.
    const policy = buildPolicyEnvelope({
      actor: approver,
      causalParentEventId: transformation.eventId,
      quorum: 1,
      reviewerRoles: ['safety-approver'],
      separationOfDuties: true,
    });
    expect(
      (await postEnvelope(url, '/v1/policies', policy.envelope, approver.actorId)).status,
    ).toBe(201);

    const approvalRequest = buildApprovalRequestEnvelope({
      actor: implementer,
      subjectArtifactId: change.artifactId,
      subjectVersionId: change.versionId,
      causalParentEventId: transformation.eventId,
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
    });
    expect(
      (
        await postEnvelope(
          url,
          '/v1/approval-requests',
          approvalRequest.envelope,
          implementer.actorId,
        )
      ).status,
    ).toBe(201);

    const approvalDecision = buildApprovalDecisionEnvelope({
      actor: approver,
      requestId: approvalRequest.requestId,
      subjectArtifactId: change.artifactId,
      subjectVersionId: change.versionId,
      causalParentEventId: approvalRequest.eventId,
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
      decision: 'approved',
      role: 'safety-approver',
    });
    expect(
      (
        await postEnvelope(
          url,
          '/v1/approval-decisions',
          approvalDecision.envelope,
          approver.actorId,
        )
      ).status,
    ).toBe(201);

    // Before any challenge: release readiness is clear.
    expect(
      assessReleaseReadiness(
        approvalDecision.eventId,
        await fetchChallenges(url, safetyAuditor.actorId),
      ).ready,
    ).toBe(true);

    // A safety auditor raises a challenge disputing the approval's formal-evidence coverage.
    const challenge = buildChallengeEnvelope({
      actor: safetyAuditor,
      disputedClaimEventId: approvalDecision.eventId,
      grounds:
        'The formal proof explicitly excludes sensor hardware faults, which this change is sensitive to.',
      requestedRemedy: 'Extend the formal model to cover sensor fault injection before release.',
    });
    expect(
      (await postEnvelope(url, '/v1/challenges', challenge.envelope, safetyAuditor.actorId)).status,
    ).toBe(201);

    // Release readiness is now blocked -- the open challenge is real, queryable ledger state, not an out-of-band note.
    const readinessDuringChallenge = assessReleaseReadiness(
      approvalDecision.eventId,
      await fetchChallenges(url, safetyAuditor.actorId),
    );
    expect(readinessDuringChallenge.ready).toBe(false);
    expect(readinessDuringChallenge.reason).toContain('open challenge');

    // The challenge is resolved (the fault-injection model was added and re-verified),
    // recorded as a real challenge_resolved event revising the same Challenge artifact.
    const resolution = buildChallengeResolutionEnvelope({
      actor: safetyAuditor,
      challengeArtifactId: challenge.artifactId,
      fromVersionId: challenge.versionId,
      challengeRaisedEventId: challenge.eventId,
      disputedClaimEventId: approvalDecision.eventId,
      grounds:
        'The formal proof explicitly excludes sensor hardware faults, which this change is sensitive to.',
      requestedRemedy: 'Extend the formal model to cover sensor fault injection before release.',
      status: 'resolved_remedied',
      rationale:
        'The formal model was extended to cover sensor fault injection and re-verified; the gap is closed.',
    });
    expect(
      (await postEnvelope(url, '/v1/challenges', resolution.envelope, safetyAuditor.actorId))
        .status,
    ).toBe(201);

    const readinessAfterResolution = assessReleaseReadiness(
      approvalDecision.eventId,
      await fetchChallenges(url, safetyAuditor.actorId),
    );
    expect(readinessAfterResolution.ready).toBe(true);
  });
});
