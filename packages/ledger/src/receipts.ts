import { digestCanonicalValue, verifyDigest } from '@act/core';
import { signBytes, verifyBytes } from '@act/crypto';

export const GENESIS_RECEIPT_DIGEST = `sha-256:${'0'.repeat(64)}`;

export interface ReceiptSignature {
  key_id: string;
  algorithm: 'ed25519';
  signature: string;
}

export interface LedgerReceipt {
  ledger_id: string;
  sequence: number;
  event_id: string;
  accepted_at: string;
  previous_receipt_digest: string;
  receipt_digest: string;
  signature: ReceiptSignature;
}

interface UnsignedReceiptFields {
  ledger_id: string;
  sequence: number;
  event_id: string;
  accepted_at: string;
  previous_receipt_digest: string;
}

function receiptDigestOf(fields: UnsignedReceiptFields): string {
  return digestCanonicalValue(fields);
}

/** Builds and signs the next receipt in a ledger's hash chain. */
export function issueReceipt(
  fields: UnsignedReceiptFields,
  signer: { keyId: string; publicKey: string; privateKey: string },
): LedgerReceipt {
  const receiptDigest = receiptDigestOf(fields);
  const signature = signBytes(
    signer.privateKey,
    signer.publicKey,
    new TextEncoder().encode(receiptDigest),
  );
  return {
    ...fields,
    receipt_digest: receiptDigest,
    signature: { key_id: signer.keyId, algorithm: 'ed25519', signature },
  };
}

export interface ReceiptVerificationResult {
  digestValid: boolean;
  signatureValid: boolean;
  chainLinkValid: boolean;
}

/**
 * Verifies a single receipt: its own digest, its signature, and (if a
 * previous receipt is supplied) that its previous_receipt_digest correctly
 * chains to that previous receipt.
 */
export function verifyReceipt(
  receipt: LedgerReceipt,
  publicKey: string | undefined,
  previousReceipt: LedgerReceipt | null,
): ReceiptVerificationResult {
  const { receipt_digest, signature, ...fields } = receipt;
  const digestValid = safeVerifyDigest(fields, receipt_digest);
  const signatureValid = publicKey
    ? verifyBytes(publicKey, new TextEncoder().encode(receipt_digest), signature.signature)
    : false;
  const chainLinkValid =
    receipt.sequence === 0
      ? receipt.previous_receipt_digest === GENESIS_RECEIPT_DIGEST
      : previousReceipt !== null &&
        receipt.previous_receipt_digest === previousReceipt.receipt_digest;
  return { digestValid, signatureValid, chainLinkValid };
}

function safeVerifyDigest(value: unknown, claimed: string): boolean {
  try {
    return verifyDigest(value, claimed);
  } catch {
    return false;
  }
}
