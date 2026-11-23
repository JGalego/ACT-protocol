import { canonicalize } from '@act/core';
import { signBytes, verifyBytes } from '@act/crypto';
import { GENESIS_RECEIPT_DIGEST, verifyReceipt, type LedgerReceipt } from './receipts.js';

/**
 * Witnessed checkpoints (ADR 0013). A checkpoint commits to a ledger's whole
 * history so far: how many receipts it has and the digest of the last one, which
 * (the chain being hash-linked) fixes every event and its order. The ledger signs
 * it; independent witnesses cosign it only when it extends what they last saw, so
 * an operator cannot show two parties different histories, or hide a tail,
 * without the contradiction being detectable.
 */

/** What every signature covers: the claim about the history. */
export interface CheckpointStatement {
  ledger_id: string;
  /** Number of receipts (the last receipt's sequence + 1). */
  size: number;
  /** Digest of the last receipt; the genesis constant when the ledger is empty. */
  head_digest: string;
}

export interface Checkpoint extends CheckpointStatement {
  issued_at: string;
}

export interface CheckpointSignature {
  key_id: string;
  algorithm: 'ed25519';
  signature: string;
}

export interface WitnessSignature extends CheckpointSignature {
  /** When the witness signed; covered by its signature. */
  signed_at: string;
}

export interface SignedCheckpoint {
  checkpoint: Checkpoint;
  ledger_signature: CheckpointSignature;
  witness_signatures: WitnessSignature[];
}

// Distinct domains, so a ledger signature can never be replayed as a witness one or the reverse.
const LEDGER_DOMAIN = 'ACT-CHECKPOINT-v1\n';
const WITNESS_DOMAIN = 'ACT-WITNESS-v1\n';

const encode = (domain: string, value: unknown) =>
  new TextEncoder().encode(domain + canonicalize(value));

export const statementOf = (c: CheckpointStatement): CheckpointStatement => ({
  ledger_id: c.ledger_id,
  size: c.size,
  head_digest: c.head_digest,
});

interface Signer {
  keyId: string;
  publicKey: string;
  privateKey: string;
}

export function signCheckpoint(checkpoint: Checkpoint, ledgerSigner: Signer): SignedCheckpoint {
  const message = encode(LEDGER_DOMAIN, {
    ...statementOf(checkpoint),
    issued_at: checkpoint.issued_at,
  });
  return {
    checkpoint,
    ledger_signature: {
      key_id: ledgerSigner.keyId,
      algorithm: 'ed25519',
      signature: signBytes(ledgerSigner.privateKey, ledgerSigner.publicKey, message),
    },
    witness_signatures: [],
  };
}

/** A witness's signature over the statement and its own signing time. */
export function witnessSignature(
  statement: CheckpointStatement,
  witness: Signer,
  signedAt: string,
): WitnessSignature {
  const message = encode(WITNESS_DOMAIN, { ...statementOf(statement), signed_at: signedAt });
  return {
    key_id: witness.keyId,
    algorithm: 'ed25519',
    signed_at: signedAt,
    signature: signBytes(witness.privateKey, witness.publicKey, message),
  };
}

/** Adds (or replaces) a witness's cosignature. */
export function cosignCheckpoint(
  signed: SignedCheckpoint,
  witness: Signer,
  signedAt: string,
): SignedCheckpoint {
  const sig = witnessSignature(signed.checkpoint, witness, signedAt);
  return {
    ...signed,
    witness_signatures: [
      ...signed.witness_signatures.filter((w) => w.key_id !== witness.keyId),
      sig,
    ],
  };
}

export function verifyWitnessSignature(
  statement: CheckpointStatement,
  sig: WitnessSignature,
  publicKey: string,
): boolean {
  const message = encode(WITNESS_DOMAIN, { ...statementOf(statement), signed_at: sig.signed_at });
  return verifyBytes(publicKey, message, sig.signature);
}

export function verifyLedgerSignature(signed: SignedCheckpoint, publicKey: string): boolean {
  const c = signed.checkpoint;
  const message = encode(LEDGER_DOMAIN, { ...statementOf(c), issued_at: c.issued_at });
  return verifyBytes(publicKey, message, signed.ledger_signature.signature);
}

export interface CheckpointTrust {
  ledgerKeyId: string;
  ledgerPublicKey: string;
  /** The consumer's own witness set: key id -> public key. */
  witnesses: Record<string, string>;
  /** How many distinct trusted witnesses must have cosigned. */
  threshold: number;
}

export interface CheckpointVerdict {
  ledgerSignatureValid: boolean;
  /** Distinct trusted witnesses whose cosignature verifies. */
  validWitnesses: string[];
  /** Ledger signature valid and at least `threshold` valid witnesses. */
  endorsed: boolean;
}

/**
 * Trusts nothing the ledger says about itself: the ledger signature must be the
 * pinned key's, and only witnesses in the consumer's own set count, each once.
 */
export function verifyCheckpoint(
  signed: SignedCheckpoint,
  trust: CheckpointTrust,
): CheckpointVerdict {
  const ledgerSignatureValid =
    signed.ledger_signature.key_id === trust.ledgerKeyId &&
    verifyLedgerSignature(signed, trust.ledgerPublicKey);
  const valid = new Set<string>();
  for (const w of signed.witness_signatures) {
    const key = trust.witnesses[w.key_id];
    if (key && verifyWitnessSignature(signed.checkpoint, w, key)) valid.add(w.key_id);
  }
  const validWitnesses = [...valid].sort();
  return {
    ledgerSignatureValid,
    validWitnesses,
    endorsed: ledgerSignatureValid && validWitnesses.length >= trust.threshold,
  };
}

export type ProofResult = { ok: true } | { ok: false; reason: string };

const fail = (reason: string): ProofResult => ({ ok: false, reason });

/**
 * `receipts` are the ledger's receipts from sequence `older.size` up to
 * `newer.size - 1`, in order. They must chain from the older head to the newer
 * one, each signed by the ledger: the newer history extends the older one.
 */
export function verifyConsistency(
  older: CheckpointStatement,
  newer: CheckpointStatement,
  receipts: readonly LedgerReceipt[],
  ledgerPublicKey: string,
): ProofResult {
  if (older.ledger_id !== newer.ledger_id) return fail('checkpoints are for different ledgers');
  if (newer.size < older.size) return fail('the newer checkpoint is smaller: history shrank');
  if (newer.size === older.size) {
    if (receipts.length !== 0) return fail('equal sizes need no receipts');
    return older.head_digest === newer.head_digest
      ? { ok: true }
      : fail('same size, different head: the history forked');
  }
  if (receipts.length !== newer.size - older.size) {
    return fail(`expected ${newer.size - older.size} receipts, got ${receipts.length}`);
  }
  let previous: string = older.head_digest;
  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i]!;
    if (r.ledger_id !== older.ledger_id) return fail(`receipt ${i} belongs to another ledger`);
    if (r.sequence !== older.size + i) return fail(`receipt ${i} has sequence ${r.sequence}`);
    if (r.previous_receipt_digest !== previous) return fail(`receipt ${r.sequence} does not chain`);
    const check = verifyReceipt(
      r,
      ledgerPublicKey,
      // the chain link was checked above against the running digest
      r.sequence === 0 ? null : ({ receipt_digest: previous } as LedgerReceipt),
    );
    if (!check.digestValid) return fail(`receipt ${r.sequence} has a wrong digest`);
    if (!check.signatureValid) return fail(`receipt ${r.sequence} is not signed by the ledger`);
    previous = r.receipt_digest;
  }
  return previous === newer.head_digest
    ? { ok: true }
    : fail('the receipts do not reach the newer head');
}

/** Inclusion of one event's receipt in a checkpoint: it, then the receipts after it up to the head, chain to the head digest. */
export function verifyInclusion(
  receipt: LedgerReceipt,
  after: readonly LedgerReceipt[],
  checkpoint: CheckpointStatement,
  ledgerPublicKey: string,
): ProofResult {
  if (receipt.ledger_id !== checkpoint.ledger_id) return fail('the receipt is for another ledger');
  if (receipt.sequence >= checkpoint.size) return fail('the receipt is beyond the checkpoint');
  const own = verifyReceipt(receipt, ledgerPublicKey, null);
  if (!own.digestValid || !own.signatureValid) return fail('the receipt is not validly signed');
  const link = verifyConsistency(
    {
      ledger_id: checkpoint.ledger_id,
      size: receipt.sequence + 1,
      head_digest: receipt.receipt_digest,
    },
    checkpoint,
    after,
    ledgerPublicKey,
  );
  return link;
}

export type CheckpointEquivocation =
  | { equivocation: true; size: number; heads: [string, string] }
  | { equivocation: false; reason: string };

/** Two ledger-signed checkpoints, same size, different heads: the operator signed two histories. */
export function detectCheckpointEquivocation(
  a: SignedCheckpoint,
  b: SignedCheckpoint,
  ledgerPublicKey: string,
): CheckpointEquivocation {
  if (a.checkpoint.ledger_id !== b.checkpoint.ledger_id) {
    return { equivocation: false, reason: 'different ledgers' };
  }
  if (!verifyLedgerSignature(a, ledgerPublicKey) || !verifyLedgerSignature(b, ledgerPublicKey)) {
    return { equivocation: false, reason: 'a checkpoint is not signed by the ledger' };
  }
  if (a.checkpoint.size !== b.checkpoint.size) {
    return { equivocation: false, reason: 'different sizes: compare them with verifyConsistency' };
  }
  if (a.checkpoint.head_digest === b.checkpoint.head_digest) {
    return { equivocation: false, reason: 'identical heads' };
  }
  return {
    equivocation: true,
    size: a.checkpoint.size,
    heads: [a.checkpoint.head_digest, b.checkpoint.head_digest],
  };
}

/** The checkpoint statement for a ledger whose last receipt is `last` (or that has none). */
export function statementFor(ledgerId: string, last: LedgerReceipt | null): CheckpointStatement {
  return {
    ledger_id: ledgerId,
    size: last ? last.sequence + 1 : 0,
    head_digest: last ? last.receipt_digest : GENESIS_RECEIPT_DIGEST,
  };
}

export interface WitnessSource {
  getCheckpoint(): Promise<SignedCheckpoint>;
  /** Receipts with sequence greater than `afterSequence`, oldest first, at most `limit`. */
  getReceipts(afterSequence: number, limit: number): Promise<LedgerReceipt[]>;
}

export type WitnessOutcome =
  | { outcome: 'cosigned'; signed: SignedCheckpoint; observed: SignedCheckpoint }
  | { outcome: 'unchanged'; observed: SignedCheckpoint }
  | {
      outcome: 'refused';
      reason: string;
      /** Set when the refusal is itself proof that the operator signed two histories. */
      equivocation?: { first: SignedCheckpoint; second: SignedCheckpoint };
    };

const PAGE = 500;

/**
 * One witness step. Fetches the ledger's current checkpoint, checks it is signed
 * by the pinned ledger key, proves it extends the checkpoint this witness last
 * cosigned (by fetching and verifying the receipts between them; from genesis on
 * first sight), and only then cosigns. The caller persists `observed` as the new
 * `last` after a `cosigned` outcome and posts `signed` back to the ledger.
 */
export async function witnessStep(options: {
  source: WitnessSource;
  ledger: { ledgerId: string; keyId: string; publicKey: string };
  /** The checkpoint this witness last cosigned for this ledger, if any. */
  last: SignedCheckpoint | null;
  witness: Signer;
  now: () => string;
}): Promise<WitnessOutcome> {
  const { source, ledger, last, witness } = options;
  const observed = await source.getCheckpoint();
  const c = observed.checkpoint;
  if (c.ledger_id !== ledger.ledgerId)
    return { outcome: 'refused', reason: 'checkpoint is for another ledger' };
  if (
    observed.ledger_signature.key_id !== ledger.keyId ||
    !verifyLedgerSignature(observed, ledger.publicKey)
  ) {
    return { outcome: 'refused', reason: 'checkpoint is not signed by the pinned ledger key' };
  }

  const from: CheckpointStatement = last
    ? last.checkpoint
    : { ledger_id: ledger.ledgerId, size: 0, head_digest: GENESIS_RECEIPT_DIGEST };

  if (c.size < from.size) {
    return {
      outcome: 'refused',
      reason: `the ledger went back from ${from.size} to ${c.size} receipts`,
    };
  }
  if (c.size === from.size) {
    if (c.head_digest !== from.head_digest) {
      return {
        outcome: 'refused',
        reason: 'two different histories of the same size, both signed by the ledger',
        ...(last ? { equivocation: { first: last, second: observed } } : {}),
      };
    }
    if (last) return { outcome: 'unchanged', observed };
  }

  const receipts: LedgerReceipt[] = [];
  for (let after = from.size - 1; receipts.length < c.size - from.size;) {
    const page = await source.getReceipts(
      after,
      Math.min(PAGE, c.size - from.size - receipts.length),
    );
    if (page.length === 0)
      return { outcome: 'refused', reason: 'the ledger would not supply the receipts it claims' };
    receipts.push(...page);
    after = page[page.length - 1]!.sequence;
  }
  const proof = verifyConsistency(from, c, receipts, ledger.publicKey);
  if (!proof.ok) return { outcome: 'refused', reason: proof.reason };

  return {
    outcome: 'cosigned',
    observed,
    signed: cosignCheckpoint(observed, witness, options.now()),
  };
}
