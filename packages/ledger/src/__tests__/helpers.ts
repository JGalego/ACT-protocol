import { generateId } from '@act/core';
import { generateKeyPair, signEnvelope, type SignedEnvelope, type Signer } from '@act/crypto';

export interface TestActor {
  actorId: string;
  signer: Signer;
}

export function makeActor(): TestActor {
  const kp = generateKeyPair();
  return {
    actorId: generateId(),
    signer: { keyId: kp.keyId, publicKey: kp.publicKey, privateKey: kp.privateKey },
  };
}

export function buildEvent(params: {
  actor: TestActor;
  eventType: string;
  subject: { kind: string; artifact_id?: string; version_id?: string };
  causalParents?: { event_id: string; relation?: string }[];
  occurredAt?: string;
  payload?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    protocol_version: 'act/1.0',
    event_type: params.eventType,
    occurred_at: params.occurredAt ?? '2026-07-16T00:00:00Z',
    actor: { actor_id: params.actor.actorId, key_id: params.actor.signer.keyId },
    tenant: 'test-tenant',
    subject: params.subject,
    causal_parents: params.causalParents ?? [],
    content_descriptors: [],
    policy_context: { not_applicable: true, reason: 'test fixture' },
    payload: params.payload ?? {},
    extensions: {},
  };
}

export function signedEnvelope(payload: Record<string, unknown>, actor: TestActor): SignedEnvelope {
  return signEnvelope(payload, [actor.signer]);
}

export function publicKeysFor(...actors: TestActor[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of actors) out[a.signer.keyId] = a.signer.publicKey;
  return out;
}
