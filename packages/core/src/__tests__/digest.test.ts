import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  digestBytes,
  digestCanonicalValue,
  InvalidDigestError,
  isValidDigestForm,
  parseDigest,
  verifyDigest,
} from '../digest.js';

describe('digestBytes', () => {
  it('matches a direct node:crypto sha256 computation', () => {
    const expected = `sha-256:${createHash('sha256').update('hello').digest('hex')}`;
    expect(digestBytes('hello')).toBe(expected);
  });
});

describe('digestCanonicalValue', () => {
  it('is order-independent for equal objects', () => {
    expect(digestCanonicalValue({ a: 1, b: 2 })).toBe(digestCanonicalValue({ b: 2, a: 1 }));
  });

  it('changes when content changes', () => {
    expect(digestCanonicalValue({ a: 1 })).not.toBe(digestCanonicalValue({ a: 2 }));
  });
});

describe('parseDigest', () => {
  it('parses a well-formed digest', () => {
    const hex = '0'.repeat(64);
    expect(parseDigest(`sha-256:${hex}`)).toEqual({ algorithm: 'sha-256', hex });
  });

  it('throws InvalidDigestError on malformed input', () => {
    expect(() => parseDigest('not-a-digest')).toThrow(InvalidDigestError);
    expect(() => parseDigest('md5:' + '0'.repeat(32))).toThrow(InvalidDigestError);
    expect(() => parseDigest('sha-256:' + '0'.repeat(63))).toThrow(InvalidDigestError);
    expect(() => parseDigest('sha-256:' + 'G'.repeat(64))).toThrow(InvalidDigestError);
  });
});

describe('isValidDigestForm', () => {
  it('accepts valid forms and rejects invalid ones', () => {
    expect(isValidDigestForm(`sha-256:${'a'.repeat(64)}`)).toBe(true);
    expect(isValidDigestForm(`sha-256:${'A'.repeat(64)}`)).toBe(false); // uppercase hex not permitted
    expect(isValidDigestForm('sha-1:abcd')).toBe(false);
  });
});

describe('verifyDigest', () => {
  it('confirms a digest recomputed over canonical bytes matches the claim', () => {
    const value = { x: 1, y: 2 };
    const digest = digestCanonicalValue(value);
    expect(verifyDigest(value, digest)).toBe(true);
  });

  it('detects tampering: any change to the value invalidates the digest', () => {
    const value = { x: 1, y: 2 };
    const digest = digestCanonicalValue(value);
    expect(verifyDigest({ x: 1, y: 3 }, digest)).toBe(false);
  });

  it('throws for a malformed claimed digest', () => {
    expect(() => verifyDigest({ x: 1 }, 'garbage')).toThrow(InvalidDigestError);
  });
});
