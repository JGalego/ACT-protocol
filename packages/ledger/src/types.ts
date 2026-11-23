import type { SignedEnvelope } from '@act/crypto';
import type { LedgerReceipt } from './receipts.js';

export interface StoredEvent {
  eventId: string;
  ledgerId: string;
  sequence: number;
  eventType: string;
  subjectKind: string | null;
  subjectArtifactId: string | null;
  subjectVersionId: string | null;
  envelope: SignedEnvelope;
  acceptedAt: string;
}

export interface TrustPolicy {
  /**
   * Returns whether this ledger trusts the given actor/key pairing to submit
   * events at all. Implementations MUST check that `keyId` is bound to
   * `actorId`, not merely that the key is known.
   */
  isTrusted(actorId: string, keyId: string): boolean;
  /**
   * Whether a key may appear as a co-signer. Optional; when absent a co-signer
   * is held to `isTrusted` with an empty actor id, so a policy that checks key
   * ownership should implement this.
   */
  isKeyTrusted?(keyId: string): boolean;
  /**
   * Like `isTrusted`, but as of an ISO time. Optional. The write path asks it
   * for an event that arrives with a source receipt, passing the receipt's
   * `accepted_at`: the instant the source ledger accepted it, which the signer
   * cannot influence (ADR 0012). A policy without it is asked `isTrusted`.
   */
  isTrustedAt?(actorId: string, keyId: string, atIso: string): boolean;
  /** Like `isKeyTrusted`, as of an ISO time (co-signers of an imported event). */
  isKeyTrustedAt?(keyId: string, atIso: string): boolean;
}

/** A trust policy backed by an explicit allowlist. There is intentionally no "trust everyone" default. */
export function allowlistTrustPolicy(trustedKeyIds: Iterable<string>): TrustPolicy {
  const allowed = new Set(trustedKeyIds);
  return { isTrusted: (_actorId: string, keyId: string) => allowed.has(keyId) };
}

export interface AppendOptions {
  /** Public keys of every signer on the envelope, keyed by key_id, needed to verify signatures. */
  publicKeys: Record<string, string>;
  /**
   * Permits accepting an event whose causal_parents reference events not
   * present in this ledger, explicitly marking the resulting lineage as a
   * partial-history boundary rather than silently treating it as complete
   * (ACT-1.0.md section 5.4, section 14.3).
   */
  allowPartialImport?: boolean;
  /**
   * Narrower form of `allowPartialImport`: only these missing parent ids are
   * tolerated (spec/federation.md section 3 step 5 -- a gap must be declared
   * by the bundle). Takes precedence over `allowPartialImport` when set.
   */
  permittedMissingParentIds?: readonly string[];
  /**
   * Key ids to treat as trusted for this single append only. Used for
   * self-registration, where the key being registered cannot be in the trust
   * registry until the event that registers it has been accepted.
   */
  additionalTrustedKeyIds?: readonly string[];
  /** Idempotency key for duplicate-submission detection independent of event content. */
  idempotencyKey?: string;
  /** Federation import only: the exporting ledger's own receipt, preserved verbatim per spec/federation.md section 3. */
  sourceReceipt?: LedgerReceipt;
}

export interface AppendResult {
  event: StoredEvent;
  receipt: LedgerReceipt;
  /** True if this event_id was already accepted; the call was a no-op returning the existing receipt. */
  duplicate: boolean;
}

export interface LineageBoundary {
  missingParentEventId: string;
  referencedBy: string;
}

export interface LineageResult {
  ancestors: StoredEvent[];
  descendants: StoredEvent[];
  boundaries: LineageBoundary[];
  truncated: boolean;
}
