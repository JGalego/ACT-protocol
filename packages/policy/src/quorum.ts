import type { ApprovalRequirementResult } from './types.js';

export interface CountedApproval {
  reviewerActorId: string;
  reviewerRole: string;
  decision: 'approved' | 'rejected' | 'changes_requested';
}

export interface QuorumEvaluationResult {
  satisfied: boolean;
  reasons: string[];
  approvedCount: number;
}

/**
 * Checks whether a set of (already individually-valid -- see
 * @act/verification for expiry/revocation/key-status checks) approval
 * decisions satisfies a policy's quorum, reviewer-role, and
 * separation-of-duties requirements for a given author.
 */
export function evaluateQuorum(
  requirement: ApprovalRequirementResult,
  approvals: CountedApproval[],
  authorActorId: string,
): QuorumEvaluationResult {
  if (!requirement.required) {
    return { satisfied: true, reasons: ['approval not required by policy'], approvedCount: 0 };
  }

  const reasons: string[] = [];
  let eligible = approvals.filter((a) => a.decision === 'approved');

  if (requirement.separationOfDuties) {
    const before = eligible.length;
    eligible = eligible.filter((a) => a.reviewerActorId !== authorActorId);
    if (eligible.length < before) {
      reasons.push('separation of duties: excluded approval(s) from the transformation author');
    }
  }

  if (requirement.reviewerRoles.length > 0) {
    const before = eligible.length;
    eligible = eligible.filter((a) => requirement.reviewerRoles.includes(a.reviewerRole));
    if (eligible.length < before) {
      reasons.push(
        `excluded approval(s) from reviewers without an eligible role (${requirement.reviewerRoles.join(', ')})`,
      );
    }
  }

  // Distinct reviewers only: the same reviewer approving twice does not count twice toward quorum.
  const distinctReviewers = new Set(eligible.map((a) => a.reviewerActorId));
  const approvedCount = distinctReviewers.size;
  const satisfied = approvedCount >= requirement.quorum;
  reasons.push(`${approvedCount} of ${requirement.quorum} required distinct approvals present`);

  return { satisfied, reasons, approvedCount };
}
