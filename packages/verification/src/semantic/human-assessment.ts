export interface HumanSemanticAssessmentInput {
  assessorActorId: string;
  classification:
    | 'exact-preservation'
    | 'clarification'
    | 'constraint-refinement'
    | 'assumption-introduction'
    | 'alternative-proposal'
    | 'intent-challenge'
    | 'semantic-modification';
  confidence: number;
  rationale: string;
  disputeStatus: 'undisputed' | 'disputed' | 'resolved';
}

export interface HumanSemanticAssessmentRecord extends HumanSemanticAssessmentInput {
  method: 'human-review';
  methodVersion: '1.0.0';
  assessedAt: string;
}

/**
 * Semantic assessor #3 (human assessment workflow, PROMPT.md's Semantic
 * Drift and Verification Toolkit section): wraps a human reviewer's
 * classification into the same attributed-assessment shape the structural
 * and AI assessors produce, so downstream policy/verification code can
 * treat all three uniformly. The API and CLI packages are responsible for
 * authentication, signing, and persistence of the resulting attestation;
 * this function only normalizes the input shape and stamps method/time.
 */
export function recordHumanSemanticAssessment(
  input: HumanSemanticAssessmentInput,
  now: () => string = () => new Date().toISOString(),
): HumanSemanticAssessmentRecord {
  if (input.confidence < 0 || input.confidence > 100 || !Number.isInteger(input.confidence)) {
    throw new RangeError(`confidence must be an integer 0-100, got ${input.confidence}`);
  }
  if (input.rationale.trim().length === 0) {
    throw new Error('A human semantic assessment must include a non-empty rationale');
  }
  return {
    ...input,
    method: 'human-review',
    methodVersion: '1.0.0',
    assessedAt: now(),
  };
}
