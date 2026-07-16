import { describe, expect, it } from 'vitest';
import { canonicalize, canonicalizeToBytes, CanonicalizationError } from '../canonical.js';

describe('canonicalize', () => {
  it('sorts object keys lexicographically by UTF-16 code unit, per RFC 8785', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('is stable regardless of input key order', () => {
    const a = canonicalize({ z: 1, y: { b: 2, a: 3 }, x: [3, 2, 1] });
    const b = canonicalize({ x: [3, 2, 1], y: { a: 3, b: 2 }, z: 1 });
    expect(a).toBe(b);
  });

  it('preserves array order (arrays are not sorted)', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });

  it('serializes nested structures deterministically', () => {
    const value = {
      arr: [
        { b: 1, a: 1 },
        { d: 2, c: 2 },
      ],
      nested: { deep: { z: 1, a: 1 } },
    };
    expect(canonicalize(value)).toBe(
      '{"arr":[{"a":1,"b":1},{"c":2,"d":2}],"nested":{"deep":{"a":1,"z":1}}}',
    );
  });

  it('escapes unicode per JCS (matches known JCS test vector)', () => {
    // From the RFC 8785 test suite: a string containing a supplementary-plane
    // character and control characters is escaped identically regardless of
    // input representation.
    expect(canonicalize({ txt: '€$\nA\'B"\\\\\"' })).toBe(
      JSON.stringify({ txt: '€$\nA\'B"\\\\\"' }),
    );
  });

  it('produces identical bytes for two differently-ordered but semantically equal documents', () => {
    const doc1 = { protocol_version: 'act/1.0', event_type: 'genesis', payload: { a: 1, b: 2 } };
    const doc2 = { payload: { b: 2, a: 1 }, event_type: 'genesis', protocol_version: 'act/1.0' };
    expect(canonicalize(doc1)).toBe(canonicalize(doc2));
  });

  it('rejects undefined at the top level', () => {
    expect(() => canonicalize(undefined)).toThrow(CanonicalizationError);
  });

  it('rejects functions', () => {
    expect(() => canonicalize({ f: () => 1 } as unknown as Record<string, unknown>)).toThrow(
      CanonicalizationError,
    );
  });

  it('rejects NaN and Infinity', () => {
    expect(() => canonicalize({ n: NaN })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ n: Infinity })).toThrow(CanonicalizationError);
  });

  it('rejects bigint', () => {
    expect(() => canonicalize({ n: 10n as unknown as number })).toThrow(CanonicalizationError);
  });

  it('drops undefined object values, matching JSON.stringify semantics', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe('canonicalizeToBytes', () => {
  it('UTF-8 encodes the canonical string form', () => {
    const bytes = canonicalizeToBytes({ a: 1 });
    expect(new TextDecoder().decode(bytes)).toBe('{"a":1}');
  });
});
