import { describe, expect, it } from 'vitest';
import {
  generateKeyPair,
  keyIdFor,
  keyIdMatchesPublicKey,
  keyPairFromPrivateKey,
  signBytes,
  verifyBytes,
} from '../keys.js';

describe('generateKeyPair', () => {
  it('produces a keyId matching the ed25519:<64-hex> form', () => {
    const { keyId } = generateKeyPair();
    expect(keyId).toMatch(/^ed25519:[0-9a-f]{64}$/);
  });

  it('produces distinct key pairs on each call', () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    expect(a.publicKey).not.toBe(b.publicKey);
    expect(a.keyId).not.toBe(b.keyId);
  });

  it('derives keyId deterministically from the public key', () => {
    const { publicKey, keyId } = generateKeyPair();
    expect(keyIdFor(publicKey)).toBe(keyId);
  });
});

describe('signBytes / verifyBytes', () => {
  it('verifies a signature made with the matching key pair', () => {
    const { publicKey, privateKey } = generateKeyPair();
    const message = new TextEncoder().encode('hello act protocol');
    const signature = signBytes(privateKey, publicKey, message);
    expect(verifyBytes(publicKey, message, signature)).toBe(true);
  });

  it('rejects a signature verified against the wrong public key', () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    const message = new TextEncoder().encode('hello');
    const signature = signBytes(a.privateKey, a.publicKey, message);
    expect(verifyBytes(b.publicKey, message, signature)).toBe(false);
  });

  it('rejects a signature over tampered content', () => {
    const { publicKey, privateKey } = generateKeyPair();
    const signature = signBytes(privateKey, publicKey, new TextEncoder().encode('original'));
    expect(verifyBytes(publicKey, new TextEncoder().encode('tampered'), signature)).toBe(false);
  });

  it('rejects a malformed signature without throwing', () => {
    const { publicKey } = generateKeyPair();
    expect(verifyBytes(publicKey, new TextEncoder().encode('x'), 'not-base64-signature!!')).toBe(
      false,
    );
  });

  it('rejects verification against a malformed public key without throwing', () => {
    expect(verifyBytes('not-a-valid-key', new TextEncoder().encode('x'), 'AA==')).toBe(false);
  });
});

describe('keyPairFromPrivateKey', () => {
  it('reconstructs the identical key pair from a stored private seed', () => {
    const original = generateKeyPair();
    const rebuilt = keyPairFromPrivateKey(original.privateKey);
    expect(rebuilt).toEqual(original);
    const message = new TextEncoder().encode('hello');
    expect(
      verifyBytes(
        original.publicKey,
        message,
        signBytes(rebuilt.privateKey, rebuilt.publicKey, message),
      ),
    ).toBe(true);
  });

  it('rejects a seed of the wrong length', () => {
    expect(() => keyPairFromPrivateKey(Buffer.from('short').toString('base64'))).toThrow(
      /32 bytes/,
    );
  });
});

describe('keyIdMatchesPublicKey', () => {
  it('accepts only the fingerprint-derived key id for a 32-byte public key', () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    expect(keyIdMatchesPublicKey(a.keyId, a.publicKey)).toBe(true);
    expect(keyIdMatchesPublicKey(a.keyId, b.publicKey)).toBe(false);
    expect(keyIdMatchesPublicKey(`ed25519:${'0'.repeat(64)}`, a.publicKey)).toBe(false);
    expect(keyIdMatchesPublicKey('x', Buffer.from('short').toString('base64'))).toBe(false);
  });
});
