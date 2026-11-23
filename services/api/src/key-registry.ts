import { verifyEnvelope, keyIdMatchesPublicKey } from '@act/crypto';
import type { KeyStatusEvent, SignedEnvelope } from '@act/crypto';
import type { Ledger, StoredEvent } from '@act/ledger';

export type KeyStatus = 'issued' | 'active' | 'rotated' | 'expired' | 'revoked' | 'compromised';

export interface KeyEntry {
  keyId: string;
  publicKey: string;
  ownerActorId: string;
  /** Ordered status history; `effectiveAt` is ledger acceptance time, never actor-claimed time. */
  history: KeyStatusEvent[];
}

const SIGNING_STATUSES: ReadonlySet<string> = new Set(['issued', 'active']);
const REGISTRATION_EVENT_TYPES: ReadonlySet<string> = new Set(['genesis', 'key_issued']);
const STATUS_EVENT_TYPES: Readonly<Record<string, KeyStatus>> = {
  key_rotated: 'rotated',
  key_revoked: 'revoked',
  key_compromised: 'compromised',
};

export type KeyEventOutcome =
  | { kind: 'not-a-key-event' }
  | { kind: 'register'; keyId: string; publicKey: string; ownerActorId: string; status: KeyStatus }
  | { kind: 'noop' }
  | { kind: 'status'; keyId: string; status: KeyStatus }
  | { kind: 'reject'; httpStatus: number; code: string; message: string };

interface KeyArtifactData {
  key_id?: string;
  algorithm?: string;
  public_key?: string;
  status?: string;
  owner_actor_id?: string;
}

const reject = (httpStatus: number, code: string, message: string): KeyEventOutcome => ({
  kind: 'reject',
  httpStatus,
  code,
  message,
});

/**
 * Decides what a Key-artifact event means against the current key state. This
 * one pure function is used both to vet a request before it is appended and to
 * rebuild the registry from the event log, so the live registry and a replay
 * can never disagree.
 *
 * - Registration (`genesis` / `key_issued`) is self-registration: the key must
 *   be the fingerprint of its own public key, sign the event that registers
 *   it, and be owned by the event's own actor. Because the id is the
 *   fingerprint, one actor can never claim another's key id.
 * - A status change (`key_rotated` / `key_revoked` / `key_compromised`) must be
 *   signed by a currently trusted key belonging to the same owner as the target.
 */
export function evaluateKeyEvent(registry: KeyRegistry, envelope: SignedEnvelope): KeyEventOutcome {
  const event = envelope.payload as {
    event_type?: string;
    actor?: { actor_id?: string; key_id?: string };
    payload?: { artifact_type?: string; data?: KeyArtifactData };
  };
  const isRegistration = REGISTRATION_EVENT_TYPES.has(event.event_type ?? '');
  const statusTarget = STATUS_EVENT_TYPES[event.event_type ?? ''];
  // `genesis` is shared by every artifact type; only a Key artifact is a key event.
  if (event.payload?.artifact_type !== 'Key') return { kind: 'not-a-key-event' };
  if (!isRegistration && !statusTarget) return { kind: 'not-a-key-event' };

  const data = event.payload.data;
  const actor = event.actor;
  if (!data?.key_id || !data.public_key || !data.owner_actor_id || !actor?.key_id) {
    return reject(400, 'invalid_key_payload', 'Key artifact is missing required fields');
  }
  if (!keyIdMatchesPublicKey(data.key_id, data.public_key)) {
    return reject(
      400,
      'key_id_mismatch',
      'key_id must be the fingerprint of public_key (ed25519:<sha-256 of the raw public key>)',
    );
  }

  if (isRegistration) {
    if (actor.key_id !== data.key_id) {
      return reject(
        400,
        'key_id_mismatch',
        "The signing actor.key_id must equal the registered Key record's key_id (self-registration)",
      );
    }
    if (actor.actor_id !== data.owner_actor_id) {
      return reject(
        400,
        'owner_mismatch',
        'A key can only be registered by the actor that owns it (owner_actor_id must equal actor.actor_id)',
      );
    }
    if (data.status !== 'issued' && data.status !== 'active') {
      return reject(400, 'invalid_key_status', "A key is registered as 'issued' or 'active'");
    }
    const proof = verifyEnvelope(envelope, { [data.key_id]: data.public_key });
    if (!proof.digestValid || !proof.signatures.some((s) => s.key_id === data.key_id && s.valid)) {
      return reject(
        400,
        'proof_of_possession_failed',
        'The embedded public key does not produce the attached signature; cannot prove possession of the private key',
      );
    }
    const existing = registry.get(data.key_id);
    if (existing) {
      return existing.publicKey === data.public_key
        ? { kind: 'noop' }
        : reject(
            409,
            'key_conflict',
            'A different public key is already registered under this key_id',
          );
    }
    return {
      kind: 'register',
      keyId: data.key_id,
      publicKey: data.public_key,
      ownerActorId: data.owner_actor_id,
      status: data.status,
    };
  }

  // Status change.
  const target = registry.get(data.key_id);
  if (!target) return reject(404, 'unknown_key', `No registered key ${data.key_id}`);
  if (data.status !== statusTarget) {
    return reject(
      400,
      'status_mismatch',
      `${event.event_type} requires data.status '${statusTarget}'`,
    );
  }
  if (target.publicKey !== data.public_key || target.ownerActorId !== data.owner_actor_id) {
    return reject(400, 'key_record_mismatch', 'The Key record does not match the registered key');
  }
  if (!actor.actor_id || !registry.isTrusted(actor.actor_id, actor.key_id)) {
    return reject(
      403,
      'untrusted_actor',
      'The status change must be signed by a currently trusted key',
    );
  }
  if (actor.actor_id !== target.ownerActorId) {
    return reject(403, 'not_key_owner', "Only the key's owner may change its status");
  }
  const current = registry.statusOf(data.key_id);
  const allowed =
    statusTarget === 'compromised'
      ? current !== 'compromised'
      : SIGNING_STATUSES.has(current ?? '');
  if (!allowed) {
    return reject(
      409,
      'invalid_key_transition',
      `A '${current}' key cannot become '${statusTarget}'`,
    );
  }
  return { kind: 'status', keyId: data.key_id, status: statusTarget! };
}

/**
 * The API's key/trust registry: a projection computed solely from the accepted
 * event log (spec section 6.2). It is never written to directly; `catchUp`
 * replays any events accepted since it last looked, so a restart -- or another
 * replica sharing the database -- yields the identical registry.
 */
export class KeyRegistry {
  private readonly keys = new Map<string, KeyEntry>();
  private lastSequence = -1;
  private chain: Promise<unknown> = Promise.resolve();

  get(keyId: string): KeyEntry | undefined {
    return this.keys.get(keyId);
  }

  statusOf(keyId: string): KeyStatus | undefined {
    const entry = this.keys.get(keyId);
    return entry?.history[entry.history.length - 1]?.status as KeyStatus | undefined;
  }

  /** Trusted to sign new events: a known, signing-capable key that belongs to `actorId`. */
  isTrusted(actorId: string, keyId: string): boolean {
    const entry = this.keys.get(keyId);
    return (
      entry !== undefined &&
      entry.ownerActorId === actorId &&
      SIGNING_STATUSES.has(this.statusOf(keyId) ?? '')
    );
  }

  isKeyTrusted(keyId: string): boolean {
    return this.keys.has(keyId) && SIGNING_STATUSES.has(this.statusOf(keyId) ?? '');
  }

  /** Every known key's public key, including retired ones, so historical signatures stay verifiable. */
  publicKeysByKeyId(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [keyId, entry] of this.keys) out[keyId] = entry.publicKey;
    return out;
  }

  /** Applies one accepted event to the projection. Events that do not validate are skipped, exactly as they were at write time. */
  applyStored(stored: StoredEvent): void {
    const outcome = evaluateKeyEvent(this, stored.envelope);
    if (outcome.kind === 'register') {
      this.keys.set(outcome.keyId, {
        keyId: outcome.keyId,
        publicKey: outcome.publicKey,
        ownerActorId: outcome.ownerActorId,
        history: [{ status: outcome.status, effectiveAt: stored.acceptedAt }],
      });
    } else if (outcome.kind === 'status') {
      this.keys.get(outcome.keyId)!.history.push({
        status: outcome.status,
        effectiveAt: stored.acceptedAt,
      });
    }
  }

  /** Replays every event accepted since the last call. Calls are serialized. */
  async catchUp(ledger: Ledger): Promise<void> {
    const run = async () => {
      for (;;) {
        const page = await ledger.listEvents(500, this.lastSequence);
        for (const stored of page) {
          this.applyStored(stored);
          this.lastSequence = stored.sequence;
        }
        if (page.length < 500) return;
      }
    };
    this.chain = this.chain.then(run, run);
    await this.chain;
  }
}
