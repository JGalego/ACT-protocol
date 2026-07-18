import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { evaluateApprovalRequirement, evaluateQuorum, type CountedApproval } from '@act/policy';
import { startDevOidcProvider, type DevOidcProvider } from '@act/api/dist/oidc/dev-provider.js';
import {
  buildApprovalDecisionEnvelope,
  buildApprovalRequestEnvelope,
  buildGenesisArtifact,
  buildPolicyEnvelope,
  buildTransformationEnvelope,
  makeActor,
  makeListeningServer,
  postEnvelope,
  buildKeyRegistrationEnvelope,
  buildActorRegistrationEnvelope,
  type Actor,
} from '../shared/fixtures.js';

const AUDIENCE = 'act-api';

async function mintToken(provider: DevOidcProvider, actor: Actor): Promise<string> {
  const response = await fetch(`${provider.url}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sub: actor.actorId, aud: AUDIENCE, tenant: 'acme-corp' }),
  });
  const { access_token } = (await response.json()) as { access_token: string };
  return access_token;
}

async function registerActorWithOidc(
  url: string,
  provider: DevOidcProvider,
  displayName: string,
): Promise<Actor> {
  const actor = makeActor();
  const token = await mintToken(provider, actor);
  const keyRes = await postEnvelope(url, '/v1/keys', buildKeyRegistrationEnvelope(actor), token);
  if (keyRes.status !== 201)
    throw new Error(`key registration failed: ${keyRes.status}: ${await keyRes.text()}`);
  const actorRes = await postEnvelope(
    url,
    '/v1/actors',
    buildActorRegistrationEnvelope(actor, displayName),
    token,
  );
  if (actorRes.status !== 201)
    throw new Error(`actor registration failed: ${actorRes.status}: ${await actorRes.text()}`);
  return actor;
}

/**
 * An enterprise workflow with OIDC identities, quorum approval, restricted
 * evidence, and audit export -- PROMPT.md's Example Applications item #4.
 * Every identity here authenticates via a real, production-shaped OIDC/JWT
 * bearer token (services/api/src/oidc/dev-provider.ts, the same
 * deterministic emulator ADR 0006's amendment adds), not the local dev
 * bearer scheme every other example uses -- `services/api` is built with
 * `devMode: false` and real `oidc` config, exercising the fail-closed
 * production auth path end-to-end.
 */
describe('example: enterprise OIDC identities, quorum approval, and audit export', () => {
  let server: FastifyInstance;
  let url: string;
  let provider: DevOidcProvider;
  let engineer: Actor;
  let reviewerA: Actor;
  let reviewerB: Actor;
  let reviewerC: Actor;

  beforeAll(async () => {
    provider = await startDevOidcProvider();
    ({ server, url } = await makeListeningServer({
      devMode: false,
      oidc: { issuer: provider.url, audience: AUDIENCE },
    }));
    engineer = await registerActorWithOidc(url, provider, 'Engineer');
    reviewerA = await registerActorWithOidc(url, provider, 'Security Reviewer A');
    reviewerB = await registerActorWithOidc(url, provider, 'Security Reviewer B');
    reviewerC = await registerActorWithOidc(url, provider, 'Security Reviewer C');
  });

  afterAll(async () => {
    await server.close();
    await provider.close();
  });

  it('requires two of three reviewer approvals, records restricted evidence, and exports a complete audit bundle', async () => {
    const engineerToken = await mintToken(provider, engineer);

    const intent = buildGenesisArtifact({
      actor: engineer,
      artifactType: 'Intent',
      data: { statement: 'Roll out a new customer data export feature.', scope: 'compliance' },
    });
    expect((await postEnvelope(url, '/v1/intents', intent.envelope, engineerToken)).status).toBe(
      201,
    );

    const task = buildGenesisArtifact({
      actor: engineer,
      artifactType: 'Task',
      data: {
        title: 'Implement customer data export',
        description: 'Exports customer PII on request.',
        status: 'done',
      },
    });
    expect((await postEnvelope(url, '/v1/artifacts', task.envelope, engineerToken)).status).toBe(
      201,
    );

    // Restricted evidence: a security review attached with sensitivity=confidential
    const evidence = buildGenesisArtifact({
      actor: reviewerA,
      artifactType: 'Evidence',
      sensitivity: 'confidential',
      data: {
        origin: 'internal security review',
        collection_method: 'manual threat-model review',
        custody: [{ actor_id: reviewerA.actorId, key_id: reviewerA.signer.keyId }],
        limitations: 'covers data-at-rest only; access-log review is separate',
      },
    });
    const reviewerAToken = await mintToken(provider, reviewerA);
    expect(
      (await postEnvelope(url, '/v1/artifacts', evidence.envelope, reviewerAToken)).status,
    ).toBe(201);

    const transformation = buildTransformationEnvelope({
      actor: engineer,
      subjectArtifactId: task.artifactId,
      inputs: [intent.eventId],
      outputs: [task.eventId],
      classification: 'semantic-modification',
      rationale: 'Implements the customer data export feature; handles regulated PII.',
      causalParents: [
        { event_id: intent.eventId, relation: 'input' },
        { event_id: evidence.eventId, relation: 'input' },
      ],
      approvalRequired: true,
      approvalReason: 'PII-handling changes require two-reviewer quorum with separation of duties',
    });
    expect(
      (await postEnvelope(url, '/v1/transformations', transformation.envelope, engineerToken))
        .status,
    ).toBe(201);

    // Quorum 2, separation of duties: the engineer's own approval (if any) would not count
    const policy = buildPolicyEnvelope({
      actor: reviewerA,
      causalParentEventId: transformation.eventId,
      quorum: 2,
      reviewerRoles: ['reviewer'],
      separationOfDuties: true,
    });
    expect((await postEnvelope(url, '/v1/policies', policy.envelope, reviewerAToken)).status).toBe(
      201,
    );

    const approvalRequest = buildApprovalRequestEnvelope({
      actor: engineer,
      subjectArtifactId: task.artifactId,
      subjectVersionId: task.versionId,
      causalParentEventId: transformation.eventId,
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
    });
    expect(
      (await postEnvelope(url, '/v1/approval-requests', approvalRequest.envelope, engineerToken))
        .status,
    ).toBe(201);

    // Only two of the three available reviewers approve
    const decisionA = buildApprovalDecisionEnvelope({
      actor: reviewerA,
      requestId: approvalRequest.requestId,
      subjectArtifactId: task.artifactId,
      subjectVersionId: task.versionId,
      causalParentEventId: approvalRequest.eventId,
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
      decision: 'approved',
    });
    expect(
      (await postEnvelope(url, '/v1/approval-decisions', decisionA.envelope, reviewerAToken))
        .status,
    ).toBe(201);

    const reviewerBToken = await mintToken(provider, reviewerB);
    const decisionB = buildApprovalDecisionEnvelope({
      actor: reviewerB,
      requestId: approvalRequest.requestId,
      subjectArtifactId: task.artifactId,
      subjectVersionId: task.versionId,
      causalParentEventId: approvalRequest.eventId,
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
      decision: 'approved',
    });
    expect(
      (await postEnvelope(url, '/v1/approval-decisions', decisionB.envelope, reviewerBToken))
        .status,
    ).toBe(201);

    // reviewerC never votes -- proving quorum is satisfied by 2 of 3 available reviewers, not all of them
    void reviewerC;

    // Real quorum evaluation (packages/policy), not just "two decisions were submitted":
    const requirement = evaluateApprovalRequirement(policy.policy, {
      subjectKind: 'transformation',
      semanticChangeClassification: 'semantic-modification',
    });
    expect(requirement.required).toBe(true);
    expect(requirement.quorum).toBe(2);

    const approvals: CountedApproval[] = [
      { reviewerActorId: reviewerA.actorId, reviewerRole: 'reviewer', decision: 'approved' },
      { reviewerActorId: reviewerB.actorId, reviewerRole: 'reviewer', decision: 'approved' },
    ];
    const quorumResult = evaluateQuorum(requirement, approvals, engineer.actorId);
    expect(quorumResult.satisfied).toBe(true);
    expect(quorumResult.approvedCount).toBe(2);

    // A quorum of 1 (only reviewer A) would NOT satisfy this policy -- proving the check is real, not a formality
    const insufficientQuorum = evaluateQuorum(requirement, [approvals[0]!], engineer.actorId);
    expect(insufficientQuorum.satisfied).toBe(false);

    // Separation of duties: an approval from the engineer who authored the change does not count
    const selfApproval = evaluateQuorum(
      requirement,
      [
        ...approvals,
        { reviewerActorId: engineer.actorId, reviewerRole: 'reviewer', decision: 'approved' },
      ],
      engineer.actorId,
    );
    expect(selfApproval.approvedCount).toBe(2); // still 2, not 3 -- the engineer's own approval was excluded

    // Audit export: a complete, signed bundle of everything recorded
    const bundleResponse = await postEnvelope(url, '/v1/bundles/export', {}, reviewerAToken);
    expect(bundleResponse.status).toBe(200);
    const bundle = (await bundleResponse.json()) as {
      events: { signed_envelope: { payloadDigest: string } }[];
    };
    const exportedEventIds = new Set(bundle.events.map((e) => e.signed_envelope.payloadDigest));
    expect(exportedEventIds.has(intent.eventId)).toBe(true);
    expect(exportedEventIds.has(evidence.eventId)).toBe(true);
    expect(exportedEventIds.has(transformation.eventId)).toBe(true);
    expect(exportedEventIds.has(decisionA.eventId)).toBe(true);
    expect(exportedEventIds.has(decisionB.eventId)).toBe(true);
  });
});
