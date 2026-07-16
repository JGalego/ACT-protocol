import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
} from 'node:crypto';
import { digestBytes } from '@act/core';

export interface KeyPair {
  /** ACT key identifier: "ed25519:<sha-256 fingerprint of the raw public key, hex>". */
  keyId: string;
  /** Raw 32-byte Ed25519 public key, base64-encoded. */
  publicKey: string;
  /** Raw 32-byte Ed25519 private key seed, base64-encoded. Never log or persist in plaintext outside a key store. */
  privateKey: string;
}

function base64UrlToBase64(b64url: string): string {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return padded;
}

function base64ToBase64Url(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Generates a fresh Ed25519 key pair. */
export function generateKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicJwk = publicKey.export({ format: 'jwk' }) as { x: string };
  const privateJwk = privateKey.export({ format: 'jwk' }) as { d: string };
  const publicKeyB64 = base64UrlToBase64(publicJwk.x);
  const privateKeyB64 = base64UrlToBase64(privateJwk.d);
  return {
    keyId: keyIdFor(publicKeyB64),
    publicKey: publicKeyB64,
    privateKey: privateKeyB64,
  };
}

/** Derives the ACT key_id ("ed25519:<hex fingerprint>") for a raw base64-encoded public key. */
export function keyIdFor(publicKeyBase64: string): string {
  const digest = digestBytes(Buffer.from(publicKeyBase64, 'base64'));
  return `ed25519:${digest.replace(/^sha-256:/, '')}`;
}

function publicKeyObjectFrom(publicKeyBase64: string) {
  const x = base64ToBase64Url(publicKeyBase64);
  return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' });
}

function privateKeyObjectFrom(privateKeyBase64: string, publicKeyBase64: string) {
  const x = base64ToBase64Url(publicKeyBase64);
  const d = base64ToBase64Url(privateKeyBase64);
  return createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', x, d }, format: 'jwk' });
}

/** Signs raw bytes with an Ed25519 private key, returning a base64-encoded signature. */
export function signBytes(
  privateKeyBase64: string,
  publicKeyBase64: string,
  message: Uint8Array,
): string {
  const key = privateKeyObjectFrom(privateKeyBase64, publicKeyBase64);
  const signature = nodeSign(null, message, key);
  return signature.toString('base64');
}

/** Verifies a base64-encoded Ed25519 signature over raw bytes. */
export function verifyBytes(
  publicKeyBase64: string,
  message: Uint8Array,
  signatureBase64: string,
): boolean {
  try {
    const key = publicKeyObjectFrom(publicKeyBase64);
    return nodeVerify(null, message, key, Buffer.from(signatureBase64, 'base64'));
  } catch {
    return false;
  }
}
