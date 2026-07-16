import { verifyEnvelope, type SignedEnvelope } from '@act/crypto';
import { verifyReceipt, type LedgerReceipt } from '@act/ledger';
import { finding, type Finding } from './findings.js';

/**
 * Verifies a single signed event's digest and every attached signature
 * independently, per ACT-1.0.md section 4.5. Returns an empty array when
 * everything checks out.
 */
export function verifyEventIntegrity(
  envelope: SignedEnvelope,
  publicKeys: Record<string, string>,
): Finding[] {
  const result = verifyEnvelope(envelope, publicKeys);
  const findings: Finding[] = [];

  if (!result.digestValid) {
    findings.push(
      finding({
        ruleId: 'integrity.digest-mismatch',
        severity: 'critical',
        resultKind: 'mechanical',
        affectedRecords: [envelope.payloadDigest],
        evidence: [envelope.payloadDigest],
        explanation:
          'The recomputed SHA-256 digest of the canonical event payload does not match the claimed payloadDigest (event_id).',
        remediation:
          'Reject this event; its content has been tampered with or corrupted after signing.',
      }),
    );
  }

  for (const sig of result.signatures) {
    if (!sig.valid) {
      findings.push(
        finding({
          ruleId: 'integrity.invalid-signature',
          severity: 'critical',
          resultKind: 'mechanical',
          affectedRecords: [envelope.payloadDigest],
          evidence: [sig.key_id],
          explanation: `The signature attributed to key_id ${sig.key_id} does not verify against the canonical event payload.`,
          remediation:
            'Reject this event, or reject only this signature if the envelope has other independently valid co-signatures.',
        }),
      );
    }
  }

  return findings;
}

/**
 * Verifies an ordered (by sequence) receipt chain for tamper-evidence, per
 * ACT-1.0.md section 5.3: each receipt's digest, signature, and link to the
 * immediately preceding receipt.
 */
export function verifyReceiptChain(
  receipts: LedgerReceipt[],
  ledgerPublicKey: string | undefined,
): Finding[] {
  const findings: Finding[] = [];
  const sorted = [...receipts].sort((a, b) => a.sequence - b.sequence);

  for (let i = 0; i < sorted.length; i++) {
    const receipt = sorted[i]!;
    const previous = i === 0 ? null : sorted[i - 1]!;
    const result = verifyReceipt(receipt, ledgerPublicKey, previous);

    if (!result.digestValid) {
      findings.push(
        finding({
          ruleId: 'integrity.receipt-digest-mismatch',
          severity: 'critical',
          resultKind: 'mechanical',
          affectedRecords: [`${receipt.ledger_id}:${receipt.sequence}`],
          evidence: [receipt.receipt_digest],
          explanation: `Receipt at sequence ${receipt.sequence} has been mutated: its recomputed digest does not match receipt_digest.`,
          remediation:
            "This ledger's history is not trustworthy from this point forward; investigate and do not accept further imports from it without independent corroboration.",
        }),
      );
    }
    if (!result.signatureValid) {
      findings.push(
        finding({
          ruleId: 'integrity.receipt-signature-invalid',
          severity: 'critical',
          resultKind: 'mechanical',
          affectedRecords: [`${receipt.ledger_id}:${receipt.sequence}`],
          evidence: [receipt.signature.key_id],
          explanation: `Receipt at sequence ${receipt.sequence} is not validly signed by the claimed ledger key.`,
          remediation:
            'Treat this receipt as unverifiable; confirm the ledger signing key has not rotated or been revoked without notice.',
        }),
      );
    }
    if (!result.chainLinkValid) {
      findings.push(
        finding({
          ruleId: 'integrity.receipt-chain-broken',
          severity: 'critical',
          resultKind: 'mechanical',
          affectedRecords: [`${receipt.ledger_id}:${receipt.sequence}`],
          evidence: [receipt.previous_receipt_digest],
          explanation: `Receipt at sequence ${receipt.sequence} does not correctly chain to the receipt at sequence ${receipt.sequence - 1}: deletion, insertion, or reordering is detectable here.`,
          remediation:
            'Locate the point of divergence and treat all receipts from this point onward as unverified pending investigation.',
        }),
      );
    }
  }

  return findings;
}
