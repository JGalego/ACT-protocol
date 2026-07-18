/**
 * One-shot generator: runs the REAL packages/core / packages/crypto
 * implementations over a fixed set of inputs and dumps the result as
 * language-neutral JSON vector files under conformance/vectors/. These are
 * generated artifacts, checked into git, and the single source of truth
 * every SDK's conformance suite (including the TypeScript SDK's own tests)
 * loads -- never hand-derived expected values, so a port can never be
 * "correct according to my own reasoning" without matching this repo's
 * actual byte output.
 *
 * Re-run manually (`pnpm run conformance:generate-vectors`) only when
 * packages/core or packages/crypto change. Keys/signatures below are
 * generated once and frozen; re-running produces a different (but
 * equally valid) frozen set, not a reproduction of these exact bytes.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  canonicalize,
  digestBytes,
  digestCanonicalValue,
  isFreshlyGeneratedId,
  isValidId,
} from '@act/core';
import {
  evaluateKeyValidityAt,
  generateKeyPair,
  keyIdFor,
  preAuthEncode,
  signBytes,
  signEnvelope,
  verifyBytes,
  type KeyStatusEvent,
} from '@act/crypto';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)));

function write(name: string, data: unknown): void {
  writeFileSync(join(OUT_DIR, `${name}.json`), JSON.stringify(data, null, 2) + '\n');
  console.log(`wrote conformance/vectors/${name}.json`);
}

// ---------------------------------------------------------------------------
// canonicalization.json
// ---------------------------------------------------------------------------
const structuralCases: { id: string; input: unknown }[] = [
  { id: 'key-sort-simple', input: { b: 1, a: 2 } },
  { id: 'key-sort-nested', input: { z: 1, y: { b: 2, a: 3 }, x: [3, 2, 1] } },
  { id: 'array-order-preserved', input: [3, 1, 2] },
  {
    id: 'nested-structures',
    input: {
      arr: [
        { b: 1, a: 1 },
        { d: 2, c: 2 },
      ],
      nested: { deep: { z: 1, a: 1 } },
    },
  },
  { id: 'unicode-jcs-vector', input: { txt: '€$\nA\'B"\\\\"' } },
  { id: 'undefined-object-value-dropped', input: { a: 1, b: undefined } },
  { id: 'booleans-and-null', input: { t: true, f: false, n: null } },
  { id: 'empty-object', input: {} },
  { id: 'empty-array', input: [] },
  {
    id: 'supplementary-plane-key-sort',
    // A key containing a character outside the BMP (requires UTF-16
    // surrogate-pair-aware comparison, not naive Unicode code-point sort).
    input: { '\u{1F600}': 1, a: 2 },
  },
];

const numberCases: { id: string; input: number }[] = [
  { id: 'zero', input: 0 },
  { id: 'negative-zero', input: -0 },
  { id: 'one', input: 1 },
  { id: 'negative-one', input: -1 },
  { id: 'point-one', input: 0.1 },
  { id: 'float-rounding', input: 0.30000000000000004 },
  { id: 'hundred', input: 100 },
  { id: 'hundred-point-zero', input: 100.0 },
  { id: 'exp-large', input: 1e21 },
  { id: 'exp-small', input: 1e-6 },
  { id: 'exp-smaller', input: 1e-7 },
  { id: 'large-integer', input: 123456789012345678 },
  { id: 'max-safe-integer', input: 9007199254740991 },
  { id: 'above-max-safe-integer', input: 9007199254740993 },
  { id: 'negative-above-max-safe-integer', input: -9007199254740993 },
  { id: 'smallest-denormal', input: 5e-324 },
  { id: 'max-double', input: 1.7976931348623157e308 },
  { id: 'two-point-five', input: 2.5 },
  { id: 'trailing-digits', input: 1000000000000000128 },
];

write('canonicalization', {
  structural: structuralCases.map((c) => ({
    id: c.id,
    input: c.input,
    expectedCanonical: canonicalize(c.input),
  })),
  numbers: numberCases.map((c) => ({
    id: c.id,
    input: c.input,
    expectedCanonical: canonicalize({ n: c.input }),
  })),
});

// ---------------------------------------------------------------------------
// digest.json
// ---------------------------------------------------------------------------
const digestValueCases = [
  { id: 'simple-object', value: { a: 1, b: 2 } },
  { id: 'reordered-equal', value: { b: 2, a: 1 } },
  { id: 'nested', value: { x: { y: [1, 2, 3] } } },
];
write('digest', {
  bytes: [
    { id: 'ascii-hello', input: 'hello', expectedDigest: digestBytes('hello') },
    { id: 'empty-string', input: '', expectedDigest: digestBytes('') },
  ],
  canonicalValues: digestValueCases.map((c) => ({
    id: c.id,
    input: c.value,
    expectedCanonical: canonicalize(c.value),
    expectedDigest: digestCanonicalValue(c.value),
  })),
});

// ---------------------------------------------------------------------------
// ids.json
// ---------------------------------------------------------------------------
const fixedIds = ['018f3b2a-1234-7abc-8def-0123456789ab', '00000000-0000-7000-8000-000000000000'];
write('ids', {
  validUuidV7: fixedIds.map((id) => ({
    id,
    expectedValid: isValidId(id),
    expectedFreshlyGenerated: isFreshlyGeneratedId(id),
  })),
  invalid: ['not-a-uuid', '018f3b2a-1234-4abc-8def-0123456789ab', ''].map((id) => ({
    id,
    expectedValid: isValidId(id),
    expectedFreshlyGenerated: isFreshlyGeneratedId(id),
  })),
});

// ---------------------------------------------------------------------------
// dsse-pae.json
// ---------------------------------------------------------------------------
const paeCases = [
  { id: 'known-vector', payloadType: 'http://example.com/HelloWorld', payload: 'hello world' },
  { id: 'empty-payload', payloadType: 'application/vnd.act+json', payload: '' },
  { id: 'json-payload', payloadType: 'application/vnd.act+json', payload: '{"a":1}' },
];
write('dsse-pae', {
  cases: paeCases.map((c) => {
    const bytes = preAuthEncode(c.payloadType, new TextEncoder().encode(c.payload));
    return {
      id: c.id,
      payloadType: c.payloadType,
      payloadUtf8: c.payload,
      expectedPaeBase64: Buffer.from(bytes).toString('base64'),
    };
  }),
});

// ---------------------------------------------------------------------------
// keys.json + signatures.json (frozen: generated once, do not regenerate
// per-run in a way that expects byte-identical output across generator runs)
// ---------------------------------------------------------------------------
const keyPairs = Array.from({ length: 3 }, () => generateKeyPair());
write('keys', {
  keyPairs: keyPairs.map((kp, i) => ({
    id: `keypair-${i}`,
    publicKeyBase64: kp.publicKey,
    expectedKeyId: keyIdFor(kp.publicKey),
  })),
});

const message = new TextEncoder().encode('ACT conformance signature vector');
write('signatures', {
  cases: keyPairs.map((kp, i) => {
    const signatureBase64 = signBytes(kp.privateKey, kp.publicKey, message);
    return {
      id: `sig-${i}`,
      publicKeyBase64: kp.publicKey,
      privateKeyBase64: kp.privateKey,
      messageUtf8: 'ACT conformance signature vector',
      expectedSignatureBase64: signatureBase64,
      expectedVerifyResult: verifyBytes(kp.publicKey, message, signatureBase64),
    };
  }),
});

// ---------------------------------------------------------------------------
// envelopes.json
// ---------------------------------------------------------------------------
const envelopePayloads = [
  {
    id: 'simple',
    payload: { protocol_version: 'act/1.0', event_type: 'genesis', payload: { a: 1 } },
  },
  {
    id: 'nested',
    payload: {
      protocol_version: 'act/1.0',
      event_type: 'transformation_recorded',
      payload: { inputs: ['a', 'b'], outputs: ['c'] },
    },
  },
];
write('envelopes', {
  cases: envelopePayloads.map((c, i) => {
    const signer = keyPairs[i % keyPairs.length]!;
    const envelope = signEnvelope(c.payload, [
      { keyId: signer.keyId, publicKey: signer.publicKey, privateKey: signer.privateKey },
    ]);
    return {
      id: c.id,
      payload: c.payload,
      signerPublicKeyBase64: signer.publicKey,
      signerPrivateKeyBase64: signer.privateKey,
      expectedPayloadDigest: envelope.payloadDigest,
      expectedSignatures: envelope.signatures,
    };
  }),
});

// ---------------------------------------------------------------------------
// key-lifecycle.json
// ---------------------------------------------------------------------------
interface LifecycleCase {
  id: string;
  history: KeyStatusEvent[];
  queryTimeIso: string;
  options?: { compromiseGracePeriodMs?: number };
}
const lifecycleCases: LifecycleCase[] = [
  {
    id: 'no-history',
    history: [],
    queryTimeIso: '2026-01-01T00:00:00Z',
  },
  {
    id: 'active-key-signing-now',
    history: [
      { status: 'issued', effectiveAt: '2026-01-01T00:00:00Z' },
      { status: 'active', effectiveAt: '2026-01-01T00:00:01Z' },
    ],
    queryTimeIso: '2026-06-01T00:00:00Z',
  },
  {
    id: 'revoked-key-signing-after-revocation',
    history: [
      { status: 'issued', effectiveAt: '2026-01-01T00:00:00Z' },
      { status: 'active', effectiveAt: '2026-01-01T00:00:01Z' },
      { status: 'revoked', effectiveAt: '2026-02-01T00:00:00Z' },
    ],
    queryTimeIso: '2026-03-01T00:00:00Z',
  },
  {
    id: 'compromised-retroactive-grace-window',
    history: [
      { status: 'issued', effectiveAt: '2026-01-01T00:00:00Z' },
      { status: 'active', effectiveAt: '2026-01-01T00:00:01Z' },
      { status: 'compromised', effectiveAt: '2026-02-01T12:00:00Z' },
    ],
    queryTimeIso: '2026-02-01T00:00:00Z',
    options: { compromiseGracePeriodMs: 24 * 60 * 60 * 1000 },
  },
  {
    id: 'compromised-before-grace-window',
    history: [
      { status: 'issued', effectiveAt: '2026-01-01T00:00:00Z' },
      { status: 'active', effectiveAt: '2026-01-01T00:00:01Z' },
      { status: 'compromised', effectiveAt: '2026-02-01T12:00:00Z' },
    ],
    queryTimeIso: '2026-01-25T00:00:00Z',
    options: { compromiseGracePeriodMs: 24 * 60 * 60 * 1000 },
  },
];
write('key-lifecycle', {
  cases: lifecycleCases.map((c) => ({
    ...c,
    expected: evaluateKeyValidityAt(c.history, c.queryTimeIso, c.options ?? {}),
  })),
});

console.log('\nAll conformance vectors regenerated.');
