import { describe, expect, it } from 'vitest';
import * as verification from '../index.js';

describe('package entrypoint', () => {
  it('re-exports the public API', () => {
    expect(typeof verification.verifyEventIntegrity).toBe('function');
    expect(typeof verification.verifyReceiptChain).toBe('function');
    expect(typeof verification.checkLineageCompleteness).toBe('function');
    expect(typeof verification.checkApprovalValidity).toBe('function');
    expect(typeof verification.assessStructural).toBe('function');
    expect(typeof verification.assessWithOpenAiCompatible).toBe('function');
    expect(typeof verification.startMockOpenAiServer).toBe('function');
    expect(typeof verification.recordHumanSemanticAssessment).toBe('function');
  });
});
