import type {
  ApprovalRequirementResult,
  EvaluationContext,
  PolicyDocument,
  PolicyRule,
  PolicyRuleMatch,
} from './types.js';

function ruleMatches(when: PolicyRuleMatch, context: EvaluationContext): boolean {
  if (
    when.subject_kind &&
    (!context.subjectKind || !when.subject_kind.includes(context.subjectKind))
  )
    return false;
  if (
    when.artifact_type &&
    (!context.artifactType || !when.artifact_type.includes(context.artifactType))
  )
    return false;
  if (
    when.semantic_change_classification &&
    (!context.semanticChangeClassification ||
      !when.semantic_change_classification.includes(context.semanticChangeClassification))
  ) {
    return false;
  }
  if (when.sensitivity && (!context.sensitivity || !when.sensitivity.includes(context.sensitivity)))
    return false;
  return true;
}

/**
 * Deterministically evaluates a policy document's rules against a request
 * context, per ACT-1.0.md section 12: whether approval is required, and
 * under what quorum/role/separation-of-duties constraints, is always
 * computed from the current policy version and the request -- never read
 * from a mutable flag on the subject itself.
 *
 * When multiple rules match, requirements combine conservatively (the
 * strictest of any matching rule's quorum/approval/separation-of-duties
 * wins, and reviewer_roles union), so that no rule can silently relax a
 * requirement another matching rule imposed.
 */
export function evaluateApprovalRequirement(
  policy: PolicyDocument,
  context: EvaluationContext,
): ApprovalRequirementResult {
  const matched: PolicyRule[] = policy.rules.filter((rule) => ruleMatches(rule.when, context));

  if (matched.length === 0) {
    return {
      required: false,
      reason: `No rule in policy ${policy.policy_id}@${policy.policy_version} matched this request`,
      quorum: 0,
      reviewerRoles: [],
      separationOfDuties: false,
      matchedRuleIds: [],
    };
  }

  let required = false;
  let quorum = 0;
  let separationOfDuties = false;
  const reviewerRoles = new Set<string>();

  for (const rule of matched) {
    if (rule.require.approval) required = true;
    if (rule.require.quorum && rule.require.quorum > quorum) quorum = rule.require.quorum;
    if (rule.require.separation_of_duties) separationOfDuties = true;
    for (const role of rule.require.reviewer_roles ?? []) reviewerRoles.add(role);
  }

  return {
    required,
    reason: required
      ? `Matched rule(s) ${matched.map((r) => r.rule_id).join(', ')} in policy ${policy.policy_id}@${policy.policy_version} require approval`
      : `Matched rule(s) ${matched.map((r) => r.rule_id).join(', ')} did not require approval`,
    quorum: required ? Math.max(quorum, 1) : quorum,
    reviewerRoles: [...reviewerRoles],
    separationOfDuties,
    matchedRuleIds: matched.map((r) => r.rule_id),
  };
}
