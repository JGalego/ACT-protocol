import { describe, expect, it } from 'vitest';
import * as core from '../index.js';

describe('package entrypoint', () => {
  it('re-exports the public API', () => {
    expect(typeof core.canonicalize).toBe('function');
    expect(typeof core.digestBytes).toBe('function');
    expect(typeof core.generateId).toBe('function');
    expect(typeof core.validateAgainst).toBe('function');
    expect(typeof core.SCHEMA_IDS).toBe('object');
  });
});
