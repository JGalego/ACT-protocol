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
  /** Returns whether this ledger trusts the given actor/key to submit events at all. */
  isTrusted(actorId: string, keyId: string): boolean;
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
