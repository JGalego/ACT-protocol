import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildApprovalDecisionEnvelope,
  buildApprovalRequestEnvelope,
  buildGenesisArtifact,
  buildPolicyEnvelope,
  buildTransformationEnvelope,
  buildVerificationEnvelope,
  makeListeningServer,
  postEnvelope,
  registerActorOn,
  type Actor,
} from '../shared/fixtures.js';

/**
 * An AI-agent group producing competing proposals and a reviewed merge --
 * PROMPT.md's Example Applications item #3. Two independent AI agents
 * each propose a different approach to the same intent; a human reviewer
 * records a Decision selecting one, and only the chosen proposal's
 * approach is carried into the implementation Task. The unselected
 * proposal remains on the ledger (never deleted), distinguishable by
 * being absent from the eventual approval chain.
 */
describe('example: competing AI proposals and a reviewed merge', () => {
  let server: FastifyInstance;
  let url: string;
  let human: Actor;
  let agentA: Actor;
  let agentB: Actor;

  beforeAll(async () => {
    ({ server, url } = await makeListeningServer());
    human = await registerActorOn(url, 'Human Reviewer');
    agentA = await registerActorOn(url, 'Planner Agent A');
    agentB = await registerActorOn(url, 'Planner Agent B');
  });

  afterAll(async () => {
    await server.close();
  });

  it('records two competing proposals, a reviewed decision, and carries only the chosen one forward', async () => {
    const intent = buildGenesisArtifact({
      actor: human,
      artifactType: 'Intent',
      data: {
        statement: 'Speed up cold-start latency for the ledger query API.',
        scope: 'ledger-api',
      },
    });
    expect((await postEnvelope(url, '/v1/intents', intent.envelope, human.actorId)).status).toBe(
      201,
    );

    // Agent A proposes an in-memory cache
    const proposalA = buildGenesisArtifact({
      actor: agentA,
      artifactType: 'AIProposal',
      data: {
        proposer: { actor_id: agentA.actorId, key_id: agentA.signer.keyId },
        model: 'planner-agent-a-v1',
        content_digest: `sha-256:${'a'.repeat(64)}`,
        rationale: 'An in-process LRU cache eliminates most cold-start round trips.',
      },
    });
    expect(
      (await postEnvelope(url, '/v1/artifacts', proposalA.envelope, agentA.actorId)).status,
    ).toBe(201);
    const tA = buildTransformationEnvelope({
      actor: agentA,
      subjectArtifactId: proposalA.artifactId,
      inputs: [intent.eventId],
      outputs: [proposalA.eventId],
      classification: 'alternative-proposal',
      rationale: 'Proposal A: in-process LRU cache.',
      causalParents: [{ event_id: intent.eventId, relation: 'input' }],
    });
    expect(
      (await postEnvelope(url, '/v1/transformations', tA.envelope, agentA.actorId)).status,
    ).toBe(201);

    // Agent B proposes a precomputed materialized view instead
    const proposalB = buildGenesisArtifact({
      actor: agentB,
      artifactType: 'AIProposal',
      data: {
        proposer: { actor_id: agentB.actorId, key_id: agentB.signer.keyId },
        model: 'planner-agent-b-v1',
        content_digest: `sha-256:${'b'.repeat(64)}`,
        rationale: 'A precomputed materialized view avoids query-time joins entirely.',
      },
    });
    expect(
      (await postEnvelope(url, '/v1/artifacts', proposalB.envelope, agentB.actorId)).status,
    ).toBe(201);
    const tB = buildTransformationEnvelope({
      actor: agentB,
      subjectArtifactId: proposalB.artifactId,
      inputs: [intent.eventId],
      outputs: [proposalB.eventId],
      classification: 'alternative-proposal',
      rationale: 'Proposal B: precomputed materialized view.',
      causalParents: [{ event_id: intent.eventId, relation: 'input' }],
    });
    expect(
      (await postEnvelope(url, '/v1/transformations', tB.envelope, agentB.actorId)).status,
    ).toBe(201);

    // The human reviewer decides between them
    const decision = buildGenesisArtifact({
      actor: human,
      artifactType: 'Decision',
      data: {
        statement: 'Adopt an in-process LRU cache for the cold-start problem.',
        options_considered: [proposalA.artifactId, proposalB.artifactId],
        chosen_option: proposalA.artifactId,
        rationale:
          'Lower operational complexity than maintaining a materialized view; sufficient for current load.',
      },
    });
    expect(
      (await postEnvelope(url, '/v1/artifacts', decision.envelope, human.actorId)).status,
    ).toBe(201);
    const decisionTransformation = buildTransformationEnvelope({
      actor: human,
      subjectArtifactId: decision.artifactId,
      inputs: [proposalA.eventId, proposalB.eventId],
      outputs: [decision.eventId],
      classification: 'clarification',
      rationale: 'Reviewed both competing proposals and selected proposal A.',
      causalParents: [
        { event_id: tA.eventId, relation: 'input' },
        { event_id: tB.eventId, relation: 'input' },
      ],
    });
    expect(
      (
        await postEnvelope(
          url,
          '/v1/transformations',
          decisionTransformation.envelope,
          human.actorId,
        )
      ).status,
    ).toBe(201);

    // Only the chosen proposal is carried into an implementation task
    const task = buildGenesisArtifact({
      actor: agentA,
      artifactType: 'Task',
      data: {
        title: 'Implement LRU cache for cold-start queries',
        description: 'Per the reviewed decision.',
        status: 'done',
      },
    });
    expect((await postEnvelope(url, '/v1/artifacts', task.envelope, agentA.actorId)).status).toBe(
      201,
    );
    const implementationTransformation = buildTransformationEnvelope({
      actor: agentA,
      subjectArtifactId: task.artifactId,
      inputs: [decision.eventId],
      outputs: [task.eventId],
      classification: 'semantic-modification',
      rationale: 'Implements the decision.',
      causalParents: [{ event_id: decisionTransformation.eventId, relation: 'input' }],
      approvalRequired: true,
      approvalReason: 'semantic-modification requires reviewer approval per policy',
    });
    expect(
      (
        await postEnvelope(
          url,
          '/v1/transformations',
          implementationTransformation.envelope,
          agentA.actorId,
        )
      ).status,
    ).toBe(201);

    const policy = buildPolicyEnvelope({
      actor: human,
      causalParentEventId: implementationTransformation.eventId,
      quorum: 1,
    });
    expect((await postEnvelope(url, '/v1/policies', policy.envelope, human.actorId)).status).toBe(
      201,
    );

    const approvalRequest = buildApprovalRequestEnvelope({
      actor: agentA,
      subjectArtifactId: task.artifactId,
      subjectVersionId: task.versionId,
      // The causal parent is the implementation transformation (whose own
      // causal_parents trace back through the decision to both proposals),
      // not the task's genesis event, which -- like every genesis event --
      // has no causal parents of its own to traverse further.
      causalParentEventId: implementationTransformation.eventId,
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
    });
    expect(
      (await postEnvelope(url, '/v1/approval-requests', approvalRequest.envelope, agentA.actorId))
        .status,
    ).toBe(201);

    const approvalDecision = buildApprovalDecisionEnvelope({
      actor: human,
      requestId: approvalRequest.requestId,
      subjectArtifactId: task.artifactId,
      subjectVersionId: task.versionId,
      causalParentEventId: approvalRequest.eventId,
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
      decision: 'approved',
    });
    expect(
      (await postEnvelope(url, '/v1/approval-decisions', approvalDecision.envelope, human.actorId))
        .status,
    ).toBe(201);

    const verification = buildVerificationEnvelope({
      actor: human,
      subjectEventId: approvalDecision.eventId,
      method: 'manual-review',
    });
    expect(
      (await postEnvelope(url, '/v1/verifications', verification.envelope, human.actorId)).status,
    ).toBe(201);

    // Assertions: both proposals are permanently recorded on the ledger...
    const proposalAEvent = await (
      await fetch(`${url}/v1/artifacts/${proposalA.artifactId}`, {
        headers: { authorization: `Bearer ${human.actorId}` },
      })
    ).json();
    const proposalBEvent = await (
      await fetch(`${url}/v1/artifacts/${proposalB.artifactId}`, {
        headers: { authorization: `Bearer ${human.actorId}` },
      })
    ).json();
    expect((proposalAEvent as { currentVersionId: string }).currentVersionId).toBe(
      proposalA.versionId,
    );
    expect((proposalBEvent as { currentVersionId: string }).currentVersionId).toBe(
      proposalB.versionId,
    );

    // ...the decision recorded exactly which one was chosen...
    const decisionEvent = await (
      await fetch(`${url}/v1/artifacts/${decision.artifactId}`, {
        headers: { authorization: `Bearer ${human.actorId}` },
      })
    ).json();
    const decisionData = (
      decisionEvent as {
        event: { envelope: { payload: { payload: { data: { chosen_option: string } } } } };
      }
    ).event.envelope.payload.payload.data;
    expect(decisionData.chosen_option).toBe(proposalA.artifactId);

    // ...and only the chosen proposal's transformation is reachable from the approved implementation.
    const lineageResponse = await (
      await fetch(`${url}/v1/lineage/${approvalDecision.eventId}?maxDepth=20`, {
        headers: { authorization: `Bearer ${human.actorId}` },
      })
    ).json();
    const ancestorIds = new Set(
      (lineageResponse as { lineage: { ancestors: { eventId: string }[] } }).lineage.ancestors.map(
        (n) => n.eventId,
      ),
    );
    expect(ancestorIds.has(decisionTransformation.eventId)).toBe(true);
    expect(ancestorIds.has(tA.eventId)).toBe(true);
    expect(ancestorIds.has(tB.eventId)).toBe(true); // the reviewer's decision transformation legitimately references both proposals it weighed
  });
});
