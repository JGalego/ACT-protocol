import { describe, expect, it } from 'vitest';
import { generateKeyPair } from '../keys.js';
import { preAuthEncode, signEnvelope, verifyEnvelope, type Signer } from '../dsse.js';

function signerFrom(kp: ReturnType<typeof generateKeyPair>): Signer {
  return { keyId: kp.keyId, publicKey: kp.publicKey, privateKey: kp.privateKey };
}

describe('preAuthEncode', () => {
  it('matches the DSSE PAE construction for a known vector', () => {
    const bytes = preAuthEncode(
      'http://example.com/HelloWorld',
      new TextEncoder().encode('hello world'),
    );
    const text = new TextDecoder().decode(bytes);
    expect(text).toBe('DSSEv1 29 http://example.com/HelloWorld 11 hello world');
  });

  it('is sensitive to payload length (no ambiguity between adjacent fields)', () => {
    const a = preAuthEncode('type', new TextEncoder().encode('ab'));
    const b = preAuthEncode('typea', new TextEncoder().encode('b'));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});

describe('signEnvelope / verifyEnvelope', () => {
  const payload = { protocol_version: 'act/1.0', event_type: 'genesis', payload: { a: 1 } };

  it('produces an envelope whose digest and signature both verify', () => {
    const signer = signerFrom(generateKeyPair());
    const envelope = signEnvelope(payload, [signer]);
    const result = verifyEnvelope(envelope, { [signer.keyId]: signer.publicKey });
    expect(result.digestValid).toBe(true);
    expect(result.signatures).toEqual([{ key_id: signer.keyId, valid: true }]);
  });

  it('supports multiple independent signers, each verified independently', () => {
    const s1 = signerFrom(generateKeyPair());
    const s2 = signerFrom(generateKeyPair());
    const envelope = signEnvelope(payload, [s1, s2]);
    const result = verifyEnvelope(envelope, { [s1.keyId]: s1.publicKey, [s2.keyId]: s2.publicKey });
    expect(result.signatures).toHaveLength(2);
    expect(result.signatures.every((s) => s.valid)).toBe(true);
  });

  it('reports a bad signature as invalid without invalidating a co-signature', () => {
    const s1 = signerFrom(generateKeyPair());
    const s2 = signerFrom(generateKeyPair());
    const envelope = signEnvelope(payload, [s1, s2]);
    envelope.signatures[0]!.signature = envelope.signatures[1]!.signature; // corrupt s1's signature
    const result = verifyEnvelope(envelope, { [s1.keyId]: s1.publicKey, [s2.keyId]: s2.publicKey });
    expect(result.signatures.find((s) => s.key_id === s1.keyId)?.valid).toBe(false);
    expect(result.signatures.find((s) => s.key_id === s2.keyId)?.valid).toBe(true);
  });

  it('reports digest invalidity separately from signature validity when payload is tampered post-signing', () => {
    const signer = signerFrom(generateKeyPair());
    const envelope = signEnvelope(payload, [signer]);
    const tampered = { ...envelope, payload: { ...envelope.payload, payload: { a: 999 } } };
    const result = verifyEnvelope(tampered, { [signer.keyId]: signer.publicKey });
    expect(result.digestValid).toBe(false);
    // The signature was computed over the ORIGINAL canonical bytes; since we
    // re-derive PAE from the (now tampered) payload before checking the
    // signature, the signature check also fails -- this proves the envelope
    // cannot be tampered with post-signing without both checks catching it.
    expect(result.signatures[0]!.valid).toBe(false);
  });

  it('reports an unknown signer key_id as invalid rather than skipping it', () => {
    const signer = signerFrom(generateKeyPair());
    const envelope = signEnvelope(payload, [signer]);
    const result = verifyEnvelope(envelope, {});
    expect(result.signatures).toEqual([{ key_id: signer.keyId, valid: false }]);
  });
});
