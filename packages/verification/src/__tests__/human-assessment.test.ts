import { describe, expect, it } from 'vitest';
import { recordHumanSemanticAssessment } from '../semantic/human-assessment.js';

describe('recordHumanSemanticAssessment', () => {
  const validInput = {
    assessorActorId: 'actor-1',
    classification: 'clarification' as const,
    confidence: 80,
    rationale: 'Restates the requirement without changing its meaning.',
    disputeStatus: 'undisputed' as const,
  };

  it('stamps method, methodVersion, and assessedAt', () => {
    const record = recordHumanSemanticAssessment(validInput, () => '2026-07-16T00:00:00Z');
    expect(record.method).toBe('human-review');
    expect(record.methodVersion).toBe('1.0.0');
    expect(record.assessedAt).toBe('2026-07-16T00:00:00Z');
    expect(record.classification).toBe('clarification');
  });

  it('rejects a non-integer or out-of-range confidence', () => {
    expect(() => recordHumanSemanticAssessment({ ...validInput, confidence: 150 })).toThrow(
      RangeError,
    );
    expect(() => recordHumanSemanticAssessment({ ...validInput, confidence: -1 })).toThrow(
      RangeError,
    );
    expect(() => recordHumanSemanticAssessment({ ...validInput, confidence: 50.5 })).toThrow(
      RangeError,
    );
  });

  it('rejects an empty rationale', () => {
    expect(() => recordHumanSemanticAssessment({ ...validInput, rationale: '   ' })).toThrow(
      /rationale/,
    );
  });

  it('uses the real clock by default', () => {
    const record = recordHumanSemanticAssessment(validInput);
    expect(() => new Date(record.assessedAt).toISOString()).not.toThrow();
  });
});
