import { generateId } from '@act/core';

export interface BuildEventParams {
  eventType: string;
  actor: { actorId: string; keyId: string };
  tenant: string | { not_applicable: true; reason: string };
  subject: {
    kind: 'artifact' | 'transformation' | 'attestation' | 'policy' | 'evidence';
    artifact_id?: string;
    version_id?: string;
    artifact_type?: string;
  };
  causalParents?: { event_id: string; relation?: string }[];
  contentDescriptors?: Record<string, unknown>[];
  policyContext?:
    { policy_id: string; policy_version: string } | { not_applicable: true; reason: string };
  payload: Record<string, unknown>;
  extensions?: Record<string, unknown>;
  occurredAt?: string;
}

/** Builds an unsigned ACT event payload with protocol defaults filled in. Pass to @act/crypto's signEnvelope to produce a submittable envelope. */
export function buildUnsignedEvent(params: BuildEventParams): Record<string, unknown> {
  return {
    protocol_version: 'act/1.0',
    event_type: params.eventType,
    occurred_at: params.occurredAt ?? new Date().toISOString(),
    actor: { actor_id: params.actor.actorId, key_id: params.actor.keyId },
    tenant: params.tenant,
    subject: params.subject,
    causal_parents: params.causalParents ?? [],
    content_descriptors: params.contentDescriptors ?? [],
    policy_context: params.policyContext ?? {
      not_applicable: true,
      reason: 'no policy configured',
    },
    payload: params.payload,
    extensions: params.extensions ?? {},
  };
}

/** Generates a fresh logical artifact id (UUIDv7). */
export function newArtifactId(): string {
  return generateId();
}
