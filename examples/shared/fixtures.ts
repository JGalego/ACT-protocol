/**
 * Shared envelope-building helpers for the seeded example applications
 * under examples/*. Generalizes the patterns proven in
 * services/api/src/__tests__/helpers.ts across every artifact type an
 * example needs, rather than hand-deriving payload shapes per example --
 * every shape here matches a real schema and (where one exists) the real
 * positive fixture under schemas/**\/fixtures/positive/.
 */
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { canonicalize, digestBytes, generateId } from '@act/core';
import { generateKeyPair, signBytes, signEnvelope, type Signer } from '@act/crypto';
import { buildUnsignedEvent } from '@act/sdk';
import { buildServer } from '@act/api';

export interface Actor {
  actorId: string;
  signer: Signer;
}

export function makeActor(): Actor {
  const kp = generateKeyPair();
  return {
    actorId: generateId(),
    signer: { keyId: kp.keyId, publicKey: kp.publicKey, privateKey: kp.privateKey },
  };
}

/** Builds and self-signs an ArtifactEnvelope-shaped record for any artifact_type. */
export function buildArtifactEnvelope(params: {
  actor: Actor;
  artifactType: string;
  data: Record<string, unknown>;
  artifactId?: string | undefined;
  lineage?: { relation: string; target_version_id: string }[] | undefined;
  sensitivity?: 'public' | 'internal' | 'confidential' | 'restricted' | undefined;
  applicablePolicy?:
    | { policy_id: string; policy_version: string }
    | { not_applicable: true; reason: string }
    | undefined;
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
      sensitivity: params.sensitivity ?? 'internal',
      availability_state: 'available',
    },
    lineage: params.lineage ?? [],
    applicable_policy: params.applicablePolicy ?? {
      not_applicable: true,
      reason: 'example fixture',
    },
    confidence_assessments: [],
    uncertainties: [],
    evidence_refs: [],
    sensitivity: params.sensitivity ?? 'internal',
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

export interface BuiltEnvelope {
  envelope: ReturnType<typeof signEnvelope>;
  artifactId: string;
  versionId: string;
  eventId: string;
}

/** A genesis event over a freshly built artifact of any type, submitted through the generic POST /v1/artifacts route. */
export function buildGenesisArtifact(params: {
  actor: Actor;
  artifactType: string;
  data: Record<string, unknown>;
  artifactId?: string;
  sensitivity?: 'public' | 'internal' | 'confidential' | 'restricted';
}): BuiltEnvelope {
  const artifact = buildArtifactEnvelope(params);
  const event = buildUnsignedEvent({
    eventType: 'genesis',
    actor: { actorId: params.actor.actorId, keyId: params.actor.signer.keyId },
    tenant: 'example',
    subject: {
      kind: 'artifact',
      artifact_id: artifact.artifact_id as string,
      version_id: artifact.version_id as string,
      artifact_type: params.artifactType,
    },
    payload: artifact,
  });
  const envelope = signEnvelope(event, [params.actor.signer]);
  return {
    envelope,
    artifactId: artifact.artifact_id as string,
    versionId: artifact.version_id as string,
    eventId: envelope.payloadDigest,
  };
}

/** A revision event over an existing logical artifact, recording a new version_id via `lineage`. */
export function buildRevisionArtifact(params: {
  actor: Actor;
  artifactType: string;
  artifactId: string;
  data: Record<string, unknown>;
  fromVersionId: string;
  causalParentEventId: string;
  lineageRelation?: string;
  sensitivity?: 'public' | 'internal' | 'confidential' | 'restricted';
}): BuiltEnvelope {
  const artifact = buildArtifactEnvelope({
    actor: params.actor,
    artifactType: params.artifactType,
    artifactId: params.artifactId,
    data: params.data,
    sensitivity: params.sensitivity,
    lineage: [
      { relation: params.lineageRelation ?? 'revises', target_version_id: params.fromVersionId },
    ],
  });
  const event = buildUnsignedEvent({
    eventType: 'artifact_revised',
    actor: { actorId: params.actor.actorId, keyId: params.actor.signer.keyId },
    tenant: 'example',
    subject: {
      kind: 'artifact',
      artifact_id: params.artifactId,
      version_id: artifact.version_id as string,
      artifact_type: params.artifactType,
    },
    causalParents: [{ event_id: params.causalParentEventId, relation: 'revision-of' }],
    payload: artifact,
  });
  const envelope = signEnvelope(event, [params.actor.signer]);
  return {
    envelope,
    artifactId: params.artifactId,
    versionId: artifact.version_id as string,
    eventId: envelope.payloadDigest,
  };
}

export function buildKeyRegistrationEnvelope(actor: Actor) {
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
    tenant: 'example',
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

export function buildActorRegistrationEnvelope(
  actor: Actor,
  displayName: string,
  actorType: 'human' | 'ai-system' | 'service' = 'human',
) {
  const actorArtifact = buildArtifactEnvelope({
    actor,
    artifactType: 'Actor',
    artifactId: actor.actorId,
    data: { actor_type: actorType, display_name: displayName, keys: [actor.signer.keyId] },
  });
  const event = buildUnsignedEvent({
    eventType: 'genesis',
    actor: { actorId: actor.actorId, keyId: actor.signer.keyId },
    tenant: 'example',
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

/** A raw Transformation record (schemas/artifact/transformation.schema.json), submitted through POST /v1/transformations -- distinct from the ArtifactEnvelope wrapper other types use; see routes/transformations.ts. */
export function buildTransformationEnvelope(params: {
  actor: Actor;
  subjectArtifactId: string;
  inputs: string[];
  outputs: string[];
  classification:
    | 'exact-preservation'
    | 'clarification'
    | 'constraint-refinement'
    | 'assumption-introduction'
    | 'alternative-proposal'
    | 'intent-challenge'
    | 'semantic-modification';
  rationale: string;
  assumptions?: string[];
  causalParents: { event_id: string; relation?: string }[];
  approvalRequired?: boolean;
  approvalReason?: string;
}) {
  const transformation = {
    transformation_id: `sha-256:${digestBytes(generateId()).slice('sha-256:'.length)}`,
    mode: 'discovery' as const,
    actor: { actor_id: params.actor.actorId, key_id: params.actor.signer.keyId },
    inputs: params.inputs,
    outputs: params.outputs,
    semantic_change_claim: {
      classification: params.classification,
      assessor: { actor_id: params.actor.actorId, key_id: params.actor.signer.keyId },
      dispute_status: 'undisputed' as const,
    },
    assumptions: params.assumptions ?? [],
    ambiguities: [],
    alternatives: [],
    rationale: params.rationale,
    confidence_assessments: [],
    uncertainties: [],
    evidence: [],
    verification_results: [],
    applicable_policy: { not_applicable: true, reason: 'no policy configured for this example' },
    approval_requirement: {
      required: params.approvalRequired ?? false,
      reason: params.approvalReason ?? 'not required by this example scenario',
    },
  };
  const event = buildUnsignedEvent({
    eventType: 'transformation_recorded',
    actor: { actorId: params.actor.actorId, keyId: params.actor.signer.keyId },
    tenant: 'example',
    subject: { kind: 'transformation', artifact_id: params.subjectArtifactId },
    causalParents: params.causalParents,
    payload: transformation,
  });
  const envelope = signEnvelope(event, [params.actor.signer]);
  return {
    envelope,
    transformationId: transformation.transformation_id,
    eventId: envelope.payloadDigest,
  };
}

export function buildApprovalRequestEnvelope(params: {
  actor: Actor;
  subjectArtifactId: string;
  subjectVersionId: string;
  causalParentEventId: string;
  policyId: string;
  policyVersion: string;
}) {
  const requestId = generateId();
  const request = {
    request_id: requestId,
    subject: { artifact_id: params.subjectArtifactId, version_id: params.subjectVersionId },
    requested_by: { actor_id: params.actor.actorId, key_id: params.actor.signer.keyId },
    policy_id: params.policyId,
    policy_version: params.policyVersion,
    requested_at: '2026-07-16T00:00:00Z',
    status: 'requested',
    signatures: [
      { key_id: params.actor.signer.keyId, algorithm: 'ed25519', signature: 'ZmFrZQ==' },
    ],
  };
  const artifact = buildArtifactEnvelope({
    actor: params.actor,
    artifactType: 'ApprovalRequest',
    data: { request },
  });
  const event = buildUnsignedEvent({
    eventType: 'approval_requested',
    actor: { actorId: params.actor.actorId, keyId: params.actor.signer.keyId },
    tenant: 'example',
    subject: {
      kind: 'attestation',
      artifact_id: artifact.artifact_id as string,
      version_id: artifact.version_id as string,
      artifact_type: 'ApprovalRequest',
    },
    causalParents: [{ event_id: params.causalParentEventId, relation: 'response-to' }],
    payload: artifact,
  });
  const envelope = signEnvelope(event, [params.actor.signer]);
  return { envelope, requestId, eventId: envelope.payloadDigest };
}

export function buildApprovalDecisionEnvelope(params: {
  actor: Actor;
  requestId: string;
  subjectArtifactId: string;
  subjectVersionId: string;
  causalParentEventId: string;
  policyId: string;
  policyVersion: string;
  decision?: 'approved' | 'rejected';
  role?: string;
  comments?: string;
}) {
  const decision = {
    decision_id: generateId(),
    request_id: params.requestId,
    subject: { artifact_id: params.subjectArtifactId, version_id: params.subjectVersionId },
    decision: params.decision ?? 'approved',
    scope: 'example',
    reviewer: { actor_id: params.actor.actorId, key_id: params.actor.signer.keyId },
    reviewer_authority: { assignment_id: generateId(), role: params.role ?? 'reviewer' },
    policy_id: params.policyId,
    policy_version: params.policyVersion,
    conditions: [],
    comments: params.comments ?? 'looks good',
    issued_at: '2026-07-16T01:00:00Z',
    expires_at: null,
    supersedes: null,
    signature: { key_id: params.actor.signer.keyId, algorithm: 'ed25519', signature: 'ZmFrZQ==' },
  };
  const artifact = buildArtifactEnvelope({
    actor: params.actor,
    artifactType: 'ApprovalDecision',
    data: { decision },
  });
  const event = buildUnsignedEvent({
    eventType: 'approval_decided',
    actor: { actorId: params.actor.actorId, keyId: params.actor.signer.keyId },
    tenant: 'example',
    subject: {
      kind: 'attestation',
      artifact_id: artifact.artifact_id as string,
      version_id: artifact.version_id as string,
      artifact_type: 'ApprovalDecision',
    },
    causalParents: [{ event_id: params.causalParentEventId, relation: 'response-to' }],
    payload: artifact,
  });
  const envelope = signEnvelope(event, [params.actor.signer]);
  return { envelope, eventId: envelope.payloadDigest };
}

export function buildChallengeEnvelope(params: {
  actor: Actor;
  disputedClaimEventId: string;
  grounds?: string;
  requestedRemedy?: string;
}) {
  const challengeId = generateId();
  const challenge = {
    challenge_id: challengeId,
    disputed_claim: params.disputedClaimEventId,
    challenger: { actor_id: params.actor.actorId, key_id: params.actor.signer.keyId },
    grounds: params.grounds ?? 'The classification is not supported by evidence.',
    evidence: [],
    requested_remedy: params.requestedRemedy ?? 'Reclassify and require approval.',
    status: 'open' as const,
    issued_at: '2026-07-16T02:00:00Z',
    signature: { key_id: params.actor.signer.keyId, algorithm: 'ed25519', signature: 'ZmFrZQ==' },
  };
  const artifact = buildArtifactEnvelope({
    actor: params.actor,
    artifactType: 'Challenge',
    artifactId: challengeId,
    data: { challenge },
  });
  const event = buildUnsignedEvent({
    eventType: 'challenge_raised',
    actor: { actorId: params.actor.actorId, keyId: params.actor.signer.keyId },
    tenant: 'example',
    subject: {
      kind: 'attestation',
      artifact_id: artifact.artifact_id as string,
      version_id: artifact.version_id as string,
      artifact_type: 'Challenge',
    },
    causalParents: [{ event_id: params.disputedClaimEventId, relation: 'response-to' }],
    payload: artifact,
  });
  const envelope = signEnvelope(event, [params.actor.signer]);
  return {
    envelope,
    challengeId,
    artifactId: artifact.artifact_id as string,
    versionId: artifact.version_id as string,
    eventId: envelope.payloadDigest,
  };
}

/** Resolves a previously-raised challenge: a revision of the same Challenge artifact recording its final status. */
export function buildChallengeResolutionEnvelope(params: {
  actor: Actor;
  challengeArtifactId: string;
  fromVersionId: string;
  challengeRaisedEventId: string;
  disputedClaimEventId: string;
  grounds: string;
  requestedRemedy: string;
  status: 'resolved_upheld' | 'resolved_rejected' | 'resolved_remedied';
  rationale: string;
}) {
  const challenge = {
    challenge_id: params.challengeArtifactId,
    disputed_claim: params.disputedClaimEventId,
    challenger: { actor_id: params.actor.actorId, key_id: params.actor.signer.keyId },
    grounds: params.grounds,
    evidence: [],
    requested_remedy: params.requestedRemedy,
    status: params.status,
    resolution: {
      resolved_by: { actor_id: params.actor.actorId, key_id: params.actor.signer.keyId },
      resolved_at: '2026-07-16T05:00:00Z',
      rationale: params.rationale,
    },
    issued_at: '2026-07-16T02:00:00Z',
    signature: { key_id: params.actor.signer.keyId, algorithm: 'ed25519', signature: 'ZmFrZQ==' },
  };
  const artifact = buildArtifactEnvelope({
    actor: params.actor,
    artifactType: 'Challenge',
    artifactId: params.challengeArtifactId,
    data: { challenge },
    lineage: [{ relation: 'revises', target_version_id: params.fromVersionId }],
  });
  const event = buildUnsignedEvent({
    eventType: 'challenge_resolved',
    actor: { actorId: params.actor.actorId, keyId: params.actor.signer.keyId },
    tenant: 'example',
    subject: {
      kind: 'attestation',
      artifact_id: artifact.artifact_id as string,
      version_id: artifact.version_id as string,
      artifact_type: 'Challenge',
    },
    causalParents: [{ event_id: params.challengeRaisedEventId, relation: 'revision-of' }],
    payload: artifact,
  });
  const envelope = signEnvelope(event, [params.actor.signer]);
  return { envelope, eventId: envelope.payloadDigest };
}

export function buildVerificationEnvelope(params: {
  actor: Actor;
  subjectEventId: string;
  method?: string;
  result?: 'pass' | 'fail' | 'inconclusive';
  limitations?: string;
}) {
  const artifact = buildArtifactEnvelope({
    actor: params.actor,
    artifactType: 'VerificationReport',
    data: {
      result: params.result ?? 'pass',
      verifier: { actor_id: params.actor.actorId, key_id: params.actor.signer.keyId },
      method: params.method ?? 'schema-validation',
      method_version: '1.0.0',
      subject_digest: params.subjectEventId,
      execution_environment: 'example',
      limitations: params.limitations ?? 'structural only',
    },
  });
  const event = buildUnsignedEvent({
    eventType: 'verification_recorded',
    actor: { actorId: params.actor.actorId, keyId: params.actor.signer.keyId },
    tenant: 'example',
    subject: {
      kind: 'attestation',
      artifact_id: artifact.artifact_id as string,
      version_id: artifact.version_id as string,
      artifact_type: 'VerificationReport',
    },
    causalParents: [{ event_id: params.subjectEventId, relation: 'response-to' }],
    payload: artifact,
  });
  const envelope = signEnvelope(event, [params.actor.signer]);
  return { envelope, eventId: envelope.payloadDigest };
}

export function buildPolicyEnvelope(params: {
  actor: Actor;
  causalParentEventId: string;
  quorum?: number;
  reviewerRoles?: string[];
  separationOfDuties?: boolean;
  classification?: string;
}) {
  const policyId = generateId();
  const policyVersion = `sha-256:${'4'.repeat(64)}`;
  const policy = {
    policy_id: policyId,
    policy_version: policyVersion,
    kind: 'approval',
    name: 'example policy',
    issued_by: { actor_id: params.actor.actorId, key_id: params.actor.signer.keyId },
    issued_at: '2026-07-16T00:00:00Z',
    supersedes: null,
    rules: [
      {
        rule_id: 'r1',
        when: {
          semantic_change_classification: [params.classification ?? 'semantic-modification'],
        },
        require: {
          approval: true,
          quorum: params.quorum ?? 1,
          reviewer_roles: params.reviewerRoles ?? ['reviewer'],
          separation_of_duties: params.separationOfDuties ?? false,
        },
      },
    ],
    signatures: [
      { key_id: params.actor.signer.keyId, algorithm: 'ed25519', signature: 'ZmFrZQ==' },
    ],
  };
  const artifact = buildArtifactEnvelope({
    actor: params.actor,
    artifactType: 'Policy',
    data: { policy },
  });
  const event = buildUnsignedEvent({
    eventType: 'policy_published',
    actor: { actorId: params.actor.actorId, keyId: params.actor.signer.keyId },
    tenant: 'example',
    subject: {
      kind: 'policy',
      artifact_id: artifact.artifact_id as string,
      version_id: artifact.version_id as string,
      artifact_type: 'Policy',
    },
    causalParents: [{ event_id: params.causalParentEventId, relation: 'response-to' }],
    payload: artifact,
  });
  const envelope = signEnvelope(event, [params.actor.signer]);
  return { envelope, policyId, policyVersion, policy, eventId: envelope.payloadDigest };
}

export function buildIntentEnvelope(actor: Actor, statement: string): BuiltEnvelope {
  return buildGenesisArtifact({
    actor,
    artifactType: 'Intent',
    data: { statement, scope: 'example' },
  });
}

// --- Real, listening HTTP server helpers (mirrors services/api's federation.test.ts pattern) ---

export async function listenEphemeral(server: FastifyInstance): Promise<string> {
  await server.listen({ port: 0, host: '127.0.0.1' });
  const addr = server.server.address() as AddressInfo;
  return `http://127.0.0.1:${addr.port}`;
}

export async function makeListeningServer(
  options: Parameters<typeof buildServer>[0] = {},
): Promise<{ server: FastifyInstance; url: string }> {
  const server = await buildServer({ devMode: true, dbPath: ':memory:', ...options });
  const url = await listenEphemeral(server);
  return { server, url };
}

export async function postEnvelope(
  url: string,
  path: string,
  envelope: unknown,
  bearerToken: string,
): Promise<Response> {
  return fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${bearerToken}` },
    body: JSON.stringify(envelope),
  });
}

export async function getJson<T>(url: string, path: string, bearerToken: string): Promise<T> {
  const response = await fetch(`${url}${path}`, {
    headers: { authorization: `Bearer ${bearerToken}` },
  });
  return (await response.json()) as T;
}

/** Registers a fresh actor's key + identity over HTTP, returning the actor. */
export async function registerActorOn(url: string, displayName = 'Example Actor'): Promise<Actor> {
  const actor = makeActor();
  const keyRes = await postEnvelope(
    url,
    '/v1/keys',
    buildKeyRegistrationEnvelope(actor),
    actor.actorId,
  );
  if (keyRes.status !== 201) {
    throw new Error(`key registration failed: HTTP ${keyRes.status}: ${await keyRes.text()}`);
  }
  const actorRes = await postEnvelope(
    url,
    '/v1/actors',
    buildActorRegistrationEnvelope(actor, displayName),
    actor.actorId,
  );
  if (actorRes.status !== 201) {
    throw new Error(`actor registration failed: HTTP ${actorRes.status}: ${await actorRes.text()}`);
  }
  return actor;
}
