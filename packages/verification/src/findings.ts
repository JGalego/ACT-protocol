/**
 * A single verification finding. Every finding MUST be explained and MUST
 * identify whether it is a mechanical fact, a policy evaluation result, a
 * heuristic assessment, or a human judgment (ACT-1.0.md section 13 /
 * PROMPT.md's Semantic Drift and Verification Toolkit section).
 */
export type FindingSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type FindingResultKind = 'mechanical' | 'policy' | 'heuristic' | 'human';

export interface Finding {
  ruleId: string;
  severity: FindingSeverity;
  resultKind: FindingResultKind;
  affectedRecords: string[];
  evidence: string[];
  explanation: string;
  remediation: string;
}

export function finding(input: Finding): Finding {
  return input;
}
