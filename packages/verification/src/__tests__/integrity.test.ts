import { describe, expect, it } from 'vitest';
import { generateKeyPair, signEnvelope, type Signer } from '@act/crypto';
import { GENESIS_RECEIPT_DIGEST, issueReceipt } from '@act/ledger';
import { verifyEventIntegrity, verifyReceiptChain } from '../integrity.js';

function makeSigner(): Signer {
  const kp = generateKeyPair();
  return { keyId: kp.keyId, publicKey: kp.publicKey, privateKey: kp.privateKey };
}

describe('verifyEventIntegrity', () => {
  const payload = { protocol_version: 'act/1.0', event_type: 'genesis', payload: {} };

  it('produces no findings for a valid envelope', () => {
    const signer = makeSigner();
    const envelope = signEnvelope(payload, [signer]);
    expect(verifyEventIntegrity(envelope, { [signer.keyId]: signer.publicKey })).toEqual([]);
  });

  it('reports a digest-mismatch finding for a tampered payload', () => {
    const signer = makeSigner();
    const envelope = signEnvelope(payload, [signer]);
    const tampered = { ...envelope, payload: { ...envelope.payload, payload: { a: 1 } } };
    const findings = verifyEventIntegrity(tampered, { [signer.keyId]: signer.publicKey });
    expect(findings.some((f) => f.ruleId === 'integrity.digest-mismatch')).toBe(true);
  });

  it('reports an invalid-signature finding for a forged signature', () => {
    const signer = makeSigner();
    const envelope = signEnvelope(payload, [signer]);
    envelope.signatures[0]!.signature = Buffer.from('forged').toString('base64');
    const findings = verifyEventIntegrity(envelope, { [signer.keyId]: signer.publicKey });
    expect(findings.some((f) => f.ruleId === 'integrity.invalid-signature')).toBe(true);
  });

  it('marks every finding with resultKind mechanical and critical severity', () => {
    const signer = makeSigner();
    const envelope = signEnvelope(payload, [signer]);
    envelope.signatures[0]!.signature = Buffer.from('forged').toString('base64');
    const findings = verifyEventIntegrity(envelope, { [signer.keyId]: signer.publicKey });
    expect(findings[0]!.resultKind).toBe('mechanical');
    expect(findings[0]!.severity).toBe('critical');
  });
});

describe('verifyReceiptChain', () => {
  it('produces no findings for a valid chain', () => {
    const signer = makeSigner();
    const first = issueReceipt(
      {
        ledger_id: 'L',
        sequence: 0,
        event_id: `sha-256:${'1'.repeat(64)}`,
        accepted_at: 't0',
        previous_receipt_digest: GENESIS_RECEIPT_DIGEST,
      },
      signer,
    );
    const second = issueReceipt(
      {
        ledger_id: 'L',
        sequence: 1,
        event_id: `sha-256:${'2'.repeat(64)}`,
        accepted_at: 't1',
        previous_receipt_digest: first.receipt_digest,
      },
      signer,
    );
    expect(verifyReceiptChain([second, first], signer.publicKey)).toEqual([]);
  });

  it('flags a broken chain link', () => {
    const signer = makeSigner();
    const first = issueReceipt(
      {
        ledger_id: 'L',
        sequence: 0,
        event_id: `sha-256:${'1'.repeat(64)}`,
        accepted_at: 't0',
        previous_receipt_digest: GENESIS_RECEIPT_DIGEST,
      },
      signer,
    );
    const second = issueReceipt(
      {
        ledger_id: 'L',
        sequence: 1,
        event_id: `sha-256:${'2'.repeat(64)}`,
        accepted_at: 't1',
        previous_receipt_digest: `sha-256:${'9'.repeat(64)}`,
      },
      signer,
    );
    const findings = verifyReceiptChain([first, second], signer.publicKey);
    expect(findings.some((f) => f.ruleId === 'integrity.receipt-chain-broken')).toBe(true);
  });

  it('flags a tampered receipt digest', () => {
    const signer = makeSigner();
    const receipt = issueReceipt(
      {
        ledger_id: 'L',
        sequence: 0,
        event_id: `sha-256:${'1'.repeat(64)}`,
        accepted_at: 't0',
        previous_receipt_digest: GENESIS_RECEIPT_DIGEST,
      },
      signer,
    );
    const tampered = { ...receipt, sequence: 7 };
    const findings = verifyReceiptChain([tampered], signer.publicKey);
    expect(findings.some((f) => f.ruleId === 'integrity.receipt-digest-mismatch')).toBe(true);
  });

  it('flags a forged receipt signature', () => {
    const signer = makeSigner();
    const attacker = makeSigner();
    const receipt = issueReceipt(
      {
        ledger_id: 'L',
        sequence: 0,
        event_id: `sha-256:${'1'.repeat(64)}`,
        accepted_at: 't0',
        previous_receipt_digest: GENESIS_RECEIPT_DIGEST,
      },
      signer,
    );
    const findings = verifyReceiptChain([receipt], attacker.publicKey);
    expect(findings.some((f) => f.ruleId === 'integrity.receipt-signature-invalid')).toBe(true);
  });
});
