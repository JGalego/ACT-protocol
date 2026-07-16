export interface PolicyRuleMatch {
  subject_kind?: string[];
  artifact_type?: string[];
  semantic_change_classification?: string[];
  sensitivity?: string[];
}

export interface PolicyRuleRequirement {
  approval?: boolean;
  quorum?: number;
  reviewer_roles?: string[];
  separation_of_duties?: boolean;
}

export interface PolicyRule {
  rule_id: string;
  when: PolicyRuleMatch;
  require: PolicyRuleRequirement;
}

export interface PolicyDocument {
  policy_id: string;
  policy_version: string;
  kind: string;
  name: string;
  rules: PolicyRule[];
}

/** The facts a policy rule is evaluated against. Every field is optional -- a rule that names a field only matches requests that specify it. */
export interface EvaluationContext {
  subjectKind?: string;
  artifactType?: string;
  semanticChangeClassification?: string;
  sensitivity?: string;
}

export interface ApprovalRequirementResult {
  required: boolean;
  reason: string;
  quorum: number;
  reviewerRoles: string[];
  separationOfDuties: boolean;
  matchedRuleIds: string[];
}
