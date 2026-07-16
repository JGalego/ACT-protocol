import { describe, expect, it } from 'vitest';
import * as policy from '../index.js';

describe('package entrypoint', () => {
  it('re-exports the public API', () => {
    expect(typeof policy.evaluateApprovalRequirement).toBe('function');
    expect(typeof policy.evaluateQuorum).toBe('function');
    expect(typeof policy.evaluateAuthoritySelection).toBe('function');
  });
});
