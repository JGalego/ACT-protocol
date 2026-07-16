import { describe, expect, it } from 'vitest';
import { generateId, isFreshlyGeneratedId, isValidId } from '../ids.js';

describe('generateId', () => {
  it('generates a valid UUID', () => {
    const id = generateId();
    expect(isValidId(id)).toBe(true);
  });

  it('generates a UUIDv7 (time-ordered)', () => {
    expect(isFreshlyGeneratedId(generateId())).toBe(true);
  });

  it('generates distinct ids on each call', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });

  it('generates monotonically non-decreasing ids over time (UUIDv7 time-ordering)', () => {
    const first = generateId();
    const second = generateId();
    expect(second >= first).toBe(true);
  });
});

describe('isValidId / isFreshlyGeneratedId', () => {
  it('rejects malformed strings', () => {
    expect(isValidId('not-a-uuid')).toBe(false);
    expect(isFreshlyGeneratedId('not-a-uuid')).toBe(false);
  });

  it('accepts a v4 UUID as valid but not as freshly generated', () => {
    const v4 = '123e4567-e89b-42d3-a456-426614174000';
    expect(isValidId(v4)).toBe(true);
    expect(isFreshlyGeneratedId(v4)).toBe(false);
  });
});
