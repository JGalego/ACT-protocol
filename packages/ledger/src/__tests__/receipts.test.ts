import { describe, expect, it } from 'vitest';
import { generateKeyPair } from '@act/crypto';
import { GENESIS_RECEIPT_DIGEST, issueReceipt, verifyReceipt } from '../receipts.js';

describe('issueReceipt / verifyReceipt', () => {
  it('produces a valid genesis receipt (sequence 0)', () => {
    const signer = generateKeyPair();
    const receipt = issueReceipt(
      {
        ledger_id: 'ledger-1',
        sequence: 0,
        event_id: `sha-256:${'1'.repeat(64)}`,
        accepted_at: '2026-07-16T00:00:00Z',
        previous_receipt_digest: GENESIS_RECEIPT_DIGEST,
      },
      { keyId: signer.keyId, publicKey: signer.publicKey, privateKey: signer.privateKey },
    );
    const result = verifyReceipt(receipt, signer.publicKey, null);
    expect(result).toEqual({ digestValid: true, signatureValid: true, chainLinkValid: true });
  });

  it('chains correctly to a previous receipt', () => {
    const signer = generateKeyPair();
    const key = { keyId: signer.keyId, publicKey: signer.publicKey, privateKey: signer.privateKey };
    const first = issueReceipt(
      {
        ledger_id: 'L',
        sequence: 0,
        event_id: `sha-256:${'1'.repeat(64)}`,
        accepted_at: 't0',
        previous_receipt_digest: GENESIS_RECEIPT_DIGEST,
      },
      key,
    );
    const second = issueReceipt(
      {
        ledger_id: 'L',
        sequence: 1,
        event_id: `sha-256:${'2'.repeat(64)}`,
        accepted_at: 't1',
        previous_receipt_digest: first.receipt_digest,
      },
      key,
    );
    const result = verifyReceipt(second, signer.publicKey, first);
    expect(result.chainLinkValid).toBe(true);
  });

  it('detects a broken chain link', () => {
    const signer = generateKeyPair();
    const key = { keyId: signer.keyId, publicKey: signer.publicKey, privateKey: signer.privateKey };
    const first = issueReceipt(
      {
        ledger_id: 'L',
        sequence: 0,
        event_id: `sha-256:${'1'.repeat(64)}`,
        accepted_at: 't0',
        previous_receipt_digest: GENESIS_RECEIPT_DIGEST,
      },
      key,
    );
    const second = issueReceipt(
      {
        ledger_id: 'L',
        sequence: 1,
        event_id: `sha-256:${'2'.repeat(64)}`,
        accepted_at: 't1',
        previous_receipt_digest: `sha-256:${'9'.repeat(64)}`,
      },
      key,
    );
    const result = verifyReceipt(second, signer.publicKey, first);
    expect(result.chainLinkValid).toBe(false);
  });

  it('detects a forged signature', () => {
    const signer = generateKeyPair();
    const attacker = generateKeyPair();
    const receipt = issueReceipt(
      {
        ledger_id: 'L',
        sequence: 0,
        event_id: `sha-256:${'1'.repeat(64)}`,
        accepted_at: 't0',
        previous_receipt_digest: GENESIS_RECEIPT_DIGEST,
      },
      { keyId: signer.keyId, publicKey: signer.publicKey, privateKey: signer.privateKey },
    );
    const result = verifyReceipt(receipt, attacker.publicKey, null);
    expect(result.signatureValid).toBe(false);
  });

  it('detects a tampered receipt digest', () => {
    const signer = generateKeyPair();
    const receipt = issueReceipt(
      {
        ledger_id: 'L',
        sequence: 0,
        event_id: `sha-256:${'1'.repeat(64)}`,
        accepted_at: 't0',
        previous_receipt_digest: GENESIS_RECEIPT_DIGEST,
      },
      { keyId: signer.keyId, publicKey: signer.publicKey, privateKey: signer.privateKey },
    );
    const tampered = { ...receipt, sequence: 5 };
    const result = verifyReceipt(tampered, signer.publicKey, null);
    expect(result.digestValid).toBe(false);
  });

  it('reports signatureValid false, without throwing, when no public key is available', () => {
    const signer = generateKeyPair();
    const receipt = issueReceipt(
      {
        ledger_id: 'L',
        sequence: 0,
        event_id: `sha-256:${'1'.repeat(64)}`,
        accepted_at: 't0',
        previous_receipt_digest: GENESIS_RECEIPT_DIGEST,
      },
      { keyId: signer.keyId, publicKey: signer.publicKey, privateKey: signer.privateKey },
    );
    const result = verifyReceipt(receipt, undefined, null);
    expect(result.signatureValid).toBe(false);
  });

  it('reports digestValid false, without throwing, for a structurally malformed digest field', () => {
    const signer = generateKeyPair();
    const receipt = issueReceipt(
      {
        ledger_id: 'L',
        sequence: 0,
        event_id: `sha-256:${'1'.repeat(64)}`,
        accepted_at: 't0',
        previous_receipt_digest: GENESIS_RECEIPT_DIGEST,
      },
      { keyId: signer.keyId, publicKey: signer.publicKey, privateKey: signer.privateKey },
    );
    const malformed = { ...receipt, receipt_digest: 'not-a-well-formed-digest' };
    const result = verifyReceipt(malformed, signer.publicKey, null);
    expect(result.digestValid).toBe(false);
  });
});
