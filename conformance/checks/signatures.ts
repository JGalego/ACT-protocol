import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { keyIdFor, preAuthEncode, signEnvelope, verifyBytes } from '@act/crypto';
import type { CheckResult } from './types.js';

const VECTORS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'vectors');
function loadVector<T>(name: string): T {
  return JSON.parse(readFileSync(join(VECTORS_DIR, `${name}.json`), 'utf8')) as T;
}

interface DssePaeVectors {
  cases: { id: string; payloadType: string; payloadUtf8: string; expectedPaeBase64: string }[];
}
interface KeyVectors {
  keyPairs: { id: string; publicKeyBase64: string; expectedKeyId: string }[];
}
interface SignatureVectors {
  cases: {
    id: string;
    publicKeyBase64: string;
    messageUtf8: string;
    expectedSignatureBase64: string;
    expectedVerifyResult: boolean;
  }[];
}
interface EnvelopeVectors {
  cases: {
    id: string;
    payload: Record<string, unknown>;
    signerPublicKeyBase64: string;
    signerPrivateKeyBase64: string;
    expectedPayloadDigest: string;
    expectedSignatures: { key_id: string }[];
  }[];
}

/** Cryptographic Integrity profile: Ed25519 sign/verify, DSSE PAE, key_id derivation (spec/conformance.md section 1). */
export function run(): CheckResult[] {
  const results: CheckResult[] = [];
  const dssePae = loadVector<DssePaeVectors>('dsse-pae');
  const keys = loadVector<KeyVectors>('keys');
  const signatures = loadVector<SignatureVectors>('signatures');
  const envelopes = loadVector<EnvelopeVectors>('envelopes');

  for (const c of dssePae.cases) {
    const bytes = preAuthEncode(c.payloadType, new TextEncoder().encode(c.payloadUtf8));
    const actual = Buffer.from(bytes).toString('base64');
    results.push({
      id: `dsse-pae/${c.id}`,
      category: 'dsse',
      profile: 'cryptographic-integrity',
      expected: c.expectedPaeBase64,
      actual,
      pass: actual === c.expectedPaeBase64,
    });
  }

  for (const c of keys.keyPairs) {
    const actual = keyIdFor(c.publicKeyBase64);
    results.push({
      id: `keys/${c.id}`,
      category: 'key-derivation',
      profile: 'cryptographic-integrity',
      expected: c.expectedKeyId,
      actual,
      pass: actual === c.expectedKeyId,
    });
  }

  for (const c of signatures.cases) {
    const message = new TextEncoder().encode(c.messageUtf8);
    const actual = verifyBytes(c.publicKeyBase64, message, c.expectedSignatureBase64);
    results.push({
      id: `signatures/${c.id}`,
      category: 'signatures',
      profile: 'cryptographic-integrity',
      expected: String(c.expectedVerifyResult),
      actual: String(actual),
      pass: actual === c.expectedVerifyResult,
    });
  }

  for (const c of envelopes.cases) {
    const envelope = signEnvelope(c.payload, [
      {
        keyId: c.expectedSignatures[0]!.key_id,
        publicKey: c.signerPublicKeyBase64,
        privateKey: c.signerPrivateKeyBase64,
      },
    ]);
    results.push({
      id: `envelopes/${c.id}`,
      category: 'dsse',
      profile: 'cryptographic-integrity',
      expected: c.expectedPayloadDigest,
      actual: envelope.payloadDigest,
      pass: envelope.payloadDigest === c.expectedPayloadDigest,
    });
  }

  return results;
}
