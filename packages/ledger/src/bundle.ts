import { digestCanonicalValue } from '@act/core';
import {
  keyIdMatchesPublicKey,
  verifyBytes,
  verifyEnvelope,
  type SignedEnvelope,
} from '@act/crypto';
import { verifyReceipt, type LedgerReceipt } from './receipts.js';

/**
 * Framework-neutral federation primitives (spec/federation.md), shared by every
 * place that imports a bundle -- the API service and the CLI -- so the rules
 * cannot drift between them.
 */

export interface BundleKnownGap {
  missing_event_id: string;
  referenced_by: string;
}

export interface BundleShape {
  bundle_id: string;
  source_ledger_id: string;
  signature: { key_id: string; algorithm: 'ed25519'; signature: string };
}

/** The identity a bundle's signer is expected to have, established by the importer out of band. */
export interface TrustedLedgerKey {
  keyId: string;
  publicKey: string;
}

export type BundleCheck = { ok: true } | { ok: false; code: string; message: string };

/**
 * A bundle's `bundle_id` must be the digest of its own body, and it must be
 * signed by the trusted key. Nothing inside an unverified bundle may be read
 * as evidence of anything.
 */
export function verifyBundleIntegrity(
  bundle: BundleShape & object,
  trusted: TrustedLedgerKey,
): BundleCheck {
  const { bundle_id, signature, ...body } = bundle;
  if (digestCanonicalValue(body) !== bundle_id) {
    return {
      ok: false,
      code: 'bundle_digest_mismatch',
      message: 'bundle_id does not match the digest of the bundle body',
    };
  }
  const signed =
    signature.key_id === trusted.keyId &&
    verifyBytes(trusted.publicKey, new TextEncoder().encode(bundle_id), signature.signature);
  if (!signed) {
    return {
      ok: false,
      code: 'invalid_bundle_signature',
      message: 'The bundle is not validly signed by the trusted ledger key',
    };
  }
  return { ok: true };
}

/**
 * Verifies one imported source receipt against the trusted ledger key. Returns
 * a human-readable failure reason, or null if the receipt checks out. Receipts
 * of a filtered export need not be consecutive, so the chain link is only
 * checked where it can be: at sequence 0, or when the previous receipt is
 * present.
 */
export function sourceReceiptProblem(
  receipt: LedgerReceipt,
  previous: LedgerReceipt | null,
  envelope: SignedEnvelope,
  expected: { ledgerId: string } & TrustedLedgerKey,
): string | null {
  if (receipt.ledger_id !== expected.ledgerId) return 'source receipt names a different ledger';
  if (receipt.event_id !== envelope.payloadDigest) return 'source receipt is for a different event';
  if (receipt.signature.key_id !== expected.keyId)
    return 'source receipt signed by an unexpected key';
  const consecutive =
    previous !== null &&
    previous.ledger_id === receipt.ledger_id &&
    previous.sequence === receipt.sequence - 1;
  const result = verifyReceipt(receipt, expected.publicKey, consecutive ? previous : null);
  if (!result.digestValid) return 'source receipt digest does not match its contents';
  if (!result.signatureValid) return 'source receipt signature is invalid';
  if ((receipt.sequence === 0 || consecutive) && !result.chainLinkValid) {
    return 'source receipt does not chain to its predecessor';
  }
  return null;
}

/** Every causal parent of an included event that is not itself included: the honest `known_gaps` of an export. */
export function computeKnownGaps(
  events: readonly { eventId: string; parentEventIds: readonly string[] }[],
): BundleKnownGap[] {
  const included = new Set(events.map((e) => e.eventId));
  const gaps: BundleKnownGap[] = [];
  for (const e of events) {
    for (const parent of e.parentEventIds) {
      if (!included.has(parent)) gaps.push({ missing_event_id: parent, referenced_by: e.eventId });
    }
  }
  return gaps;
}

/** Groups declared gaps by the event that referenced them, for `permittedMissingParentIds`. */
export function gapsByReferencingEvent(gaps: readonly BundleKnownGap[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const gap of gaps) {
    out.set(gap.referenced_by, [...(out.get(gap.referenced_by) ?? []), gap.missing_event_id]);
  }
  return out;
}

export interface SelfRegisteredKey {
  keyId: string;
  publicKey: string;
  ownerActorId: string;
}

/**
 * Recognizes a valid key self-registration: a Key artifact event whose key id is
 * the fingerprint of its own public key, signed by that key, authored by the
 * key's owner. Returns null for anything else (including events that are not
 * key registrations at all).
 */
export function parseSelfRegisteredKey(envelope: SignedEnvelope): SelfRegisteredKey | null {
  const event = envelope.payload as {
    event_type?: string;
    actor?: { actor_id?: string; key_id?: string };
    payload?: {
      artifact_type?: string;
      data?: { key_id?: string; public_key?: string; owner_actor_id?: string; status?: string };
    };
  };
  if (event.event_type !== 'genesis' && event.event_type !== 'key_issued') return null;
  if (event.payload?.artifact_type !== 'Key') return null;
  const data = event.payload.data;
  if (!data?.key_id || !data.public_key || !data.owner_actor_id) return null;
  if (data.status !== 'issued' && data.status !== 'active') return null;
  if (!keyIdMatchesPublicKey(data.key_id, data.public_key)) return null;
  if (event.actor?.key_id !== data.key_id || event.actor?.actor_id !== data.owner_actor_id)
    return null;
  const proof = verifyEnvelope(envelope, { [data.key_id]: data.public_key });
  if (
    !proof.digestValid ||
    !proof.signatures.some((sig) => sig.key_id === data.key_id && sig.valid)
  ) {
    return null;
  }
  return { keyId: data.key_id, publicKey: data.public_key, ownerActorId: data.owner_actor_id };
}
