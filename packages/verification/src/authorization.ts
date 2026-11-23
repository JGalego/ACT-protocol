import type { KeyValidityResult } from '@act/crypto';
import {
  evaluateQuorum,
  type ApprovalRequirementResult,
  type CountedApproval,
  type QuorumEvaluationResult,
} from '@act/policy';
import { checkApprovalValidity, type ApprovalDecisionRecord } from './approval.js';
import type { Finding } from './findings.js';

export interface ApprovalAuthorizationParams {
  /** What the policy requires for this action (from `evaluateApprovalRequirement`). */
  requirement: ApprovalRequirementResult;
  /** Every decision recorded for the subject, in any state. */
  decisions: readonly ApprovalDecisionRecord[];
  /** The actor who authored the transformation being approved (for separation of duties). */
  authorActorId: string;
  /** The exact subject version the action would apply to. */
  currentSubjectVersionId: string;
  currentPolicyVersion: string;
  now: string;
  /** The reviewer key's validity at the time each decision was issued. */
  keyValidityAtIssuance: (decision: ApprovalDecisionRecord) => KeyValidityResult;
  /**
   * Whether an approval issued under an older policy version may still count.
   * Default false: spec section 8.3 lets it count only where the applicable
   * policy explicitly defines a carry-forward rule.
   */
  allowPolicyVersionDrift?: boolean;
}

export interface ApprovalAuthorizationResult {
  /** True iff the action is currently authorized under spec section 8.3. */
  authorized: boolean;
  /** Decisions that individually pass every validity check and were offered to the quorum rule. */
  validDecisionIds: string[];
  /** Why each other decision did not count. */
  rejected: { decisionId: string; findings: Finding[] }[];
  quorum: QuorumEvaluationResult;
}

/**
 * Decides whether an action is currently authorized by the recorded approvals.
 *
 * `checkApprovalValidity` judges one decision and `evaluateQuorum` judges a
 * set of already-valid decisions; neither alone answers "may this action
 * proceed". This is the composition spec section 8.3 asks for, "jointly": a
 * decision only counts toward quorum if it matches the exact subject version,
 * is in the `approved` state, has not expired, was signed by a key in good
 * standing, and (unless drift is allowed) was issued under the current policy
 * version; then distinct, role-eligible, non-author reviewers are counted.
 *
 * This function is the code counterpart of `formal/modules/ApprovalAuthorization.tla`
 * and is differentially tested against an independent transcription of the
 * spec predicate (`__tests__/authorization.test.ts`).
 */
export function evaluateApprovalAuthorization(
  params: ApprovalAuthorizationParams,
): ApprovalAuthorizationResult {
  const valid: ApprovalDecisionRecord[] = [];
  const rejected: { decisionId: string; findings: Finding[] }[] = [];

  for (const decision of params.decisions) {
    const findings = checkApprovalValidity({
      decision,
      currentSubjectVersionId: params.currentSubjectVersionId,
      currentPolicyVersion: params.currentPolicyVersion,
      reviewerKeyValidityAtIssuance: params.keyValidityAtIssuance(decision),
      now: params.now,
    }).filter(
      (f) =>
        !(params.allowPolicyVersionDrift === true && f.ruleId === 'approval.policy-version-drift'),
    );
    if (findings.length === 0) valid.push(decision);
    else rejected.push({ decisionId: decision.decisionId, findings });
  }

  const counted: CountedApproval[] = valid.map((d) => ({
    reviewerActorId: d.reviewerActorId,
    reviewerRole: d.reviewerRole,
    decision: d.decision,
  }));
  const quorum = evaluateQuorum(params.requirement, counted, params.authorActorId);

  return {
    authorized: quorum.satisfied,
    validDecisionIds: valid.map((d) => d.decisionId),
    rejected,
    quorum,
  };
}
