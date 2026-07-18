import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildApprovalDecisionEnvelope,
  buildApprovalRequestEnvelope,
  buildGenesisArtifact,
  buildPolicyEnvelope,
  buildRevisionArtifact,
  buildTransformationEnvelope,
  buildVerificationEnvelope,
  makeListeningServer,
  postEnvelope,
  registerActorOn,
  type Actor,
} from '../shared/fixtures.js';

/**
 * A product team moves from intent through requirements, implementation,
 * and tests, to a policy-required approval -- PROMPT.md example #2. One
 * real revision (the implementation Task is revised after its first test
 * run fails) is included, matching the "at least one revision" checklist
 * item. Every step is a real signed envelope submitted to a real,
 * listening services/api instance, backed by an in-memory SQLite ledger.
 */
describe('example: product team workflow', () => {
  let server: FastifyInstance;
  let url: string;
  let owner: Actor;
  let engineer: Actor;
  let reviewer: Actor;

  beforeAll(async () => {
    ({ server, url } = await makeListeningServer());
    owner = await registerActorOn(url, 'Product Owner');
    engineer = await registerActorOn(url, 'Engineer');
    reviewer = await registerActorOn(url, 'Tech Lead (Reviewer)');
  });

  afterAll(async () => {
    await server.close();
  });

  it('carries an intent through requirements, a failed test, a revision, and an approved release', async () => {
    // 1. Intent
    const intent = buildGenesisArtifact({
      actor: owner,
      artifactType: 'Intent',
      data: {
        statement: 'Reduce checkout abandonment by simplifying the payment step.',
        scope: 'checkout',
      },
    });
    expect((await postEnvelope(url, '/v1/intents', intent.envelope, owner.actorId)).status).toBe(
      201,
    );

    // 2. Two requirements, each derived from the intent via a transformation
    const requirement1 = buildGenesisArtifact({
      actor: owner,
      artifactType: 'Requirement',
      data: {
        statement: 'Checkout must support one-click payment for returning customers.',
        requirement_type: 'functional',
        priority: 'must',
        traces_to: [],
      },
    });
    expect(
      (await postEnvelope(url, '/v1/artifacts', requirement1.envelope, owner.actorId)).status,
    ).toBe(201);
    const t1 = buildTransformationEnvelope({
      actor: owner,
      subjectArtifactId: requirement1.artifactId,
      inputs: [intent.eventId],
      outputs: [requirement1.eventId],
      classification: 'clarification',
      rationale: 'Derived a concrete requirement from the checkout-abandonment intent.',
      causalParents: [{ event_id: intent.eventId, relation: 'input' }],
    });
    expect(
      (await postEnvelope(url, '/v1/transformations', t1.envelope, owner.actorId)).status,
    ).toBe(201);

    const requirement2 = buildGenesisArtifact({
      actor: owner,
      artifactType: 'Requirement',
      data: {
        statement: 'Payment errors must be recoverable without losing cart contents.',
        requirement_type: 'functional',
        priority: 'must',
        traces_to: [],
      },
    });
    expect(
      (await postEnvelope(url, '/v1/artifacts', requirement2.envelope, owner.actorId)).status,
    ).toBe(201);
    const t2 = buildTransformationEnvelope({
      actor: owner,
      subjectArtifactId: requirement2.artifactId,
      inputs: [intent.eventId],
      outputs: [requirement2.eventId],
      classification: 'clarification',
      rationale: 'A second requirement covering payment-failure recovery.',
      causalParents: [{ event_id: intent.eventId, relation: 'input' }],
    });
    expect(
      (await postEnvelope(url, '/v1/transformations', t2.envelope, owner.actorId)).status,
    ).toBe(201);

    // 3. Implementation Task, v1
    const taskV1 = buildGenesisArtifact({
      actor: engineer,
      artifactType: 'Task',
      data: {
        title: 'Implement one-click payment',
        description: 'Store a payment token for returning customers.',
        status: 'in_progress',
      },
    });
    expect(
      (await postEnvelope(url, '/v1/artifacts', taskV1.envelope, engineer.actorId)).status,
    ).toBe(201);
    const t3 = buildTransformationEnvelope({
      actor: engineer,
      subjectArtifactId: taskV1.artifactId,
      inputs: [requirement1.eventId, requirement2.eventId],
      outputs: [taskV1.eventId],
      classification: 'semantic-modification',
      rationale: 'Implements both requirements as a single checkout change.',
      assumptions: ['Payment tokens are already supported by the payment provider SDK.'],
      causalParents: [
        { event_id: requirement1.eventId, relation: 'input' },
        { event_id: requirement2.eventId, relation: 'input' },
      ],
      approvalRequired: true,
      approvalReason: 'semantic-modification requires reviewer approval per policy',
    });
    expect(
      (await postEnvelope(url, '/v1/transformations', t3.envelope, engineer.actorId)).status,
    ).toBe(201);

    // 4. First test run fails
    const testV1 = buildGenesisArtifact({
      actor: engineer,
      artifactType: 'Test',
      data: { name: 'checkout_one_click_payment_test', status: 'failing', framework: 'vitest' },
    });
    expect(
      (await postEnvelope(url, '/v1/artifacts', testV1.envelope, engineer.actorId)).status,
    ).toBe(201);

    // 5. Revision: the task is revised in response to the failing test (the required "at least one revision").
    // The causal parent is the original implementation transformation (t3) rather than the
    // test event itself, so the revision's lineage still traces back through the requirements
    // to the intent -- the failing test's role in prompting this revision is recorded narratively
    // in `data.description` and via the artifact-level `lineage` (revises taskV1's version_id).
    const taskV2 = buildRevisionArtifact({
      actor: engineer,
      artifactType: 'Task',
      artifactId: taskV1.artifactId,
      fromVersionId: taskV1.versionId,
      data: {
        title: 'Implement one-click payment',
        description:
          'Store a payment token; also validate token expiry before charging (fixes checkout_one_click_payment_test failure).',
        status: 'done',
      },
      causalParentEventId: t3.eventId,
      lineageRelation: 'revises',
    });
    expect(
      (await postEnvelope(url, '/v1/artifacts', taskV2.envelope, engineer.actorId)).status,
    ).toBe(201);

    // 6. Second test run passes
    const testV2 = buildGenesisArtifact({
      actor: engineer,
      artifactType: 'Test',
      data: { name: 'checkout_one_click_payment_test', status: 'passing', framework: 'vitest' },
    });
    expect(
      (await postEnvelope(url, '/v1/artifacts', testV2.envelope, engineer.actorId)).status,
    ).toBe(201);

    // 7. Policy requiring one reviewer approval for semantic-modification transformations
    const policy = buildPolicyEnvelope({
      actor: reviewer,
      causalParentEventId: t3.eventId,
      quorum: 1,
    });
    expect(
      (await postEnvelope(url, '/v1/policies', policy.envelope, reviewer.actorId)).status,
    ).toBe(201);

    // 8. Approval request + decision
    const approvalRequest = buildApprovalRequestEnvelope({
      actor: engineer,
      subjectArtifactId: taskV2.artifactId,
      subjectVersionId: taskV2.versionId,
      causalParentEventId: taskV2.eventId,
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
    });
    expect(
      (await postEnvelope(url, '/v1/approval-requests', approvalRequest.envelope, engineer.actorId))
        .status,
    ).toBe(201);

    const approvalDecision = buildApprovalDecisionEnvelope({
      actor: reviewer,
      requestId: approvalRequest.requestId,
      subjectArtifactId: taskV2.artifactId,
      subjectVersionId: taskV2.versionId,
      causalParentEventId: approvalRequest.eventId,
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
      decision: 'approved',
    });
    const decisionResponse = await postEnvelope(
      url,
      '/v1/approval-decisions',
      approvalDecision.envelope,
      reviewer.actorId,
    );
    expect(decisionResponse.status).toBe(201);

    // 9. Verification output over the approved, revised task
    const verification = buildVerificationEnvelope({
      actor: reviewer,
      subjectEventId: approvalDecision.eventId,
      method: 'manual-review',
      result: 'pass',
    });
    expect(
      (await postEnvelope(url, '/v1/verifications', verification.envelope, reviewer.actorId))
        .status,
    ).toBe(201);

    // Assertions proving the expected outcome: the approval chain traces
    // back through the revision to the implementation transformation and
    // the requirements it consumed; separately, each requirement's own
    // transformation traces back to the originating intent. (Genesis
    // events are lineage roots by protocol design -- schemas/event/
    // unsigned-event.schema.json requires an empty causal_parents for
    // event_type "genesis" -- so a requirement's link to the intent lives
    // in the transformation record that produced it, not in the
    // requirement's own event-graph ancestors.)
    async function lineageAncestorIds(eventId: string): Promise<Set<string>> {
      const response = await (
        await fetch(`${url}/v1/lineage/${eventId}?maxDepth=20`, {
          headers: { authorization: `Bearer ${reviewer.actorId}` },
        })
      ).json();
      const { ancestors } = (response as { lineage: { ancestors: { eventId: string }[] } }).lineage;
      return new Set(ancestors.map((n) => n.eventId));
    }

    const decisionAncestors = await lineageAncestorIds(approvalDecision.eventId);
    expect(decisionAncestors.has(approvalRequest.eventId)).toBe(true);
    expect(decisionAncestors.has(taskV2.eventId)).toBe(true);
    expect(decisionAncestors.has(t3.eventId)).toBe(true);
    expect(decisionAncestors.has(requirement1.eventId)).toBe(true);
    expect(decisionAncestors.has(requirement2.eventId)).toBe(true);

    const requirement1Ancestors = await lineageAncestorIds(t1.eventId);
    expect(requirement1Ancestors.has(intent.eventId)).toBe(true);
    const requirement2Ancestors = await lineageAncestorIds(t2.eventId);
    expect(requirement2Ancestors.has(intent.eventId)).toBe(true);

    const versions = await (
      await fetch(`${url}/v1/artifacts/${taskV1.artifactId}/versions`, {
        headers: { authorization: `Bearer ${reviewer.actorId}` },
      })
    ).json();
    // listEventsForArtifact matches on subject.artifact_id regardless of
    // subject.kind, so this also includes t3 (the transformation recorded
    // against this same artifact_id) alongside the genesis (v1) and
    // revision (v2) events -- assert both real versions are present rather
    // than an exact count.
    const versionEventIds = new Set(
      (versions as { items: { eventId: string }[] }).items.map((e) => e.eventId),
    );
    expect(versionEventIds.has(taskV1.eventId)).toBe(true);
    expect(versionEventIds.has(taskV2.eventId)).toBe(true);

    const diff = await (
      await fetch(
        `${url}/v1/artifacts/${taskV1.artifactId}/diff?from=${encodeURIComponent(taskV1.versionId)}&to=${encodeURIComponent(taskV2.versionId)}`,
        { headers: { authorization: `Bearer ${reviewer.actorId}` } },
      )
    ).json();
    expect(
      (diff as { diff: { path: string }[] }).diff.some((d) => d.path === '$.data.status'),
    ).toBe(true);
  });
});
