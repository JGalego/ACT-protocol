import { canonicalize, digestCanonicalValue, verifyDigest } from '@act/core';
import { signBytes, verifyBytes } from './keys.js';

const DSSE_PAE_PREFIX = 'DSSEv1';

/**
 * DSSE PreAuthenticationEncoding, per
 * https://github.com/secure-systems-lab/dsse/blob/master/protocol.md:
 * PAE(type, body) = "DSSEv1" + SP + LEN(type) + SP + type + SP + LEN(body) + SP + body
 */
export function preAuthEncode(payloadType: string, payloadBytes: Uint8Array): Uint8Array {
  const encoder = new TextEncoder();
  const typeBytes = encoder.encode(payloadType);
  const header = encoder.encode(
    `${DSSE_PAE_PREFIX} ${typeBytes.length} ${payloadType} ${payloadBytes.length} `,
  );
  const out = new Uint8Array(header.length + payloadBytes.length);
  out.set(header, 0);
  out.set(payloadBytes, header.length);
  return out;
}

export const EVENT_PAYLOAD_TYPE = 'application/vnd.act.event+json';
export const RECEIPT_PAYLOAD_TYPE = 'application/vnd.act.receipt+json';

export interface EnvelopeSignature {
  key_id: string;
  algorithm: 'ed25519';
  signature: string;
}

export interface SignedEnvelope {
  payloadType: string;
  payload: Record<string, unknown>;
  payloadDigest: string;
  signatures: EnvelopeSignature[];
}

export interface Signer {
  keyId: string;
  publicKey: string;
  privateKey: string;
}

/**
 * Builds a signed DSSE-compatible envelope around an unsigned payload
 * (typically an ACT unsigned event). The payload digest (the event_id) is
 * SHA-256 over the RFC 8785 canonical payload bytes; the signature itself
 * covers the DSSE PAE construction over those same canonical bytes, per
 * ACT-1.0.md section 4.2.
 */
export function signEnvelope(
  payload: Record<string, unknown>,
  signers: Signer[],
  payloadType: string = EVENT_PAYLOAD_TYPE,
): SignedEnvelope {
  const canonicalBytes = new TextEncoder().encode(canonicalize(payload));
  const payloadDigest = digestCanonicalValue(payload);
  const pae = preAuthEncode(payloadType, canonicalBytes);
  const signatures = signers.map((signer) => ({
    key_id: signer.keyId,
    algorithm: 'ed25519' as const,
    signature: signBytes(signer.privateKey, signer.publicKey, pae),
  }));
  return { payloadType, payload, payloadDigest, signatures };
}

export interface SignatureVerificationResult {
  key_id: string;
  valid: boolean;
}

export interface EnvelopeVerificationResult {
  /** Whether payloadDigest matches the recomputed digest of the canonical payload. */
  digestValid: boolean;
  /** Per-signature cryptographic validity. Never collapsed into one boolean (ACT-1.0.md section 4.5). */
  signatures: SignatureVerificationResult[];
}

/**
 * Verifies an envelope's digest and every attached signature independently.
 * `publicKeys` maps key_id -> base64 public key for every signer whose
 * signature should be checked; a signature whose key_id is not in the map
 * is reported as invalid (unknown key), never silently skipped.
 */
export function verifyEnvelope(
  envelope: SignedEnvelope,
  publicKeys: Record<string, string>,
): EnvelopeVerificationResult {
  const digestValid = verifyDigestSafely(envelope.payload, envelope.payloadDigest);
  const canonicalBytes = new TextEncoder().encode(canonicalize(envelope.payload));
  const pae = preAuthEncode(envelope.payloadType, canonicalBytes);
  const signatures = envelope.signatures.map((sig) => {
    const publicKey = publicKeys[sig.key_id];
    if (!publicKey) return { key_id: sig.key_id, valid: false };
    return { key_id: sig.key_id, valid: verifyBytes(publicKey, pae, sig.signature) };
  });
  return { digestValid, signatures };
}

function verifyDigestSafely(payload: unknown, claimedDigest: string): boolean {
  try {
    return verifyDigest(payload, claimedDigest);
  } catch {
    return false;
  }
}
