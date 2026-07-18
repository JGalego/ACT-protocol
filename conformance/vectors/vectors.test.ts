import { describe, expect, it } from 'vitest';
import {
  canonicalize,
  digestBytes,
  digestCanonicalValue,
  isFreshlyGeneratedId,
  isValidId,
} from '@act/core';
import {
  evaluateKeyValidityAt,
  keyIdFor,
  preAuthEncode,
  signEnvelope,
  verifyBytes,
  type KeyStatusEvent,
} from '@act/crypto';
import canonicalization from './canonicalization.json';
import digest from './digest.json';
import ids from './ids.json';
import dssePae from './dsse-pae.json';
import keys from './keys.json';
import signatures from './signatures.json';
import envelopes from './envelopes.json';
import keyLifecycle from './key-lifecycle.json';

// Proves the TypeScript implementation matches its OWN generated vectors --
// closing the loop so packages/core/packages/crypto can never silently
// drift from the ground truth every other SDK's conformance suite loads.
// (Cross-language interop with the Python SDK is a separate test,
// conformance/interop/, added once sdks/python exists.)

describe('canonicalization vectors', () => {
  it.each(canonicalization.structural)('$id', (c) => {
    expect(canonicalize(c.input)).toBe(c.expectedCanonical);
  });

  it.each(canonicalization.numbers)('number: $id', (c) => {
    expect(canonicalize({ n: c.input })).toBe(c.expectedCanonical);
  });
});

describe('digest vectors', () => {
  it.each(digest.bytes)('$id', (c) => {
    expect(digestBytes(c.input)).toBe(c.expectedDigest);
  });

  it.each(digest.canonicalValues)('$id', (c) => {
    expect(canonicalize(c.input)).toBe(c.expectedCanonical);
    expect(digestCanonicalValue(c.input)).toBe(c.expectedDigest);
  });
});

describe('id vectors', () => {
  it.each([...ids.validUuidV7, ...ids.invalid])('$id', (c) => {
    expect(isValidId(c.id)).toBe(c.expectedValid);
    expect(isFreshlyGeneratedId(c.id)).toBe(c.expectedFreshlyGenerated);
  });
});

describe('DSSE PAE vectors', () => {
  it.each(dssePae.cases)('$id', (c) => {
    const bytes = preAuthEncode(c.payloadType, new TextEncoder().encode(c.payloadUtf8));
    expect(Buffer.from(bytes).toString('base64')).toBe(c.expectedPaeBase64);
  });
});

describe('key vectors', () => {
  it.each(keys.keyPairs)('$id', (c) => {
    expect(keyIdFor(c.publicKeyBase64)).toBe(c.expectedKeyId);
  });
});

describe('signature vectors', () => {
  it.each(signatures.cases)('$id', (c) => {
    const message = new TextEncoder().encode(c.messageUtf8);
    expect(verifyBytes(c.publicKeyBase64, message, c.expectedSignatureBase64)).toBe(
      c.expectedVerifyResult,
    );
  });
});

describe('envelope vectors', () => {
  it.each(envelopes.cases)('$id', (c) => {
    const envelope = signEnvelope(c.payload, [
      {
        keyId: c.expectedSignatures[0]!.key_id,
        publicKey: c.signerPublicKeyBase64,
        privateKey: c.signerPrivateKeyBase64,
      },
    ]);
    expect(envelope.payloadDigest).toBe(c.expectedPayloadDigest);
  });
});

describe('key-lifecycle vectors', () => {
  it.each(keyLifecycle.cases)('$id', (c) => {
    const result = evaluateKeyValidityAt(
      c.history as KeyStatusEvent[],
      c.queryTimeIso,
      c.options ?? {},
    );
    expect(result).toEqual(c.expected);
  });
});
