import { describe, expect, it } from 'vitest';
import { evaluateQuorum, type CountedApproval } from '../quorum.js';
import type { ApprovalRequirementResult } from '../types.js';

const requirement: ApprovalRequirementResult = {
  required: true,
  reason: 'test',
  quorum: 2,
  reviewerRoles: ['reviewer'],
  separationOfDuties: true,
  matchedRuleIds: ['r1'],
};

describe('evaluateQuorum', () => {
  it('is satisfied trivially when approval is not required', () => {
    const result = evaluateQuorum({ ...requirement, required: false }, [], 'author-1');
    expect(result.satisfied).toBe(true);
  });

  it('is not satisfied with too few distinct approvals', () => {
    const approvals: CountedApproval[] = [
      { reviewerActorId: 'r1', reviewerRole: 'reviewer', decision: 'approved' },
    ];
    const result = evaluateQuorum(requirement, approvals, 'author-1');
    expect(result.satisfied).toBe(false);
    expect(result.approvedCount).toBe(1);
  });

  it('is satisfied once quorum distinct approvals are present', () => {
    const approvals: CountedApproval[] = [
      { reviewerActorId: 'r1', reviewerRole: 'reviewer', decision: 'approved' },
      { reviewerActorId: 'r2', reviewerRole: 'reviewer', decision: 'approved' },
    ];
    const result = evaluateQuorum(requirement, approvals, 'author-1');
    expect(result.satisfied).toBe(true);
    expect(result.approvedCount).toBe(2);
  });

  it('does not double-count the same reviewer approving twice', () => {
    const approvals: CountedApproval[] = [
      { reviewerActorId: 'r1', reviewerRole: 'reviewer', decision: 'approved' },
      { reviewerActorId: 'r1', reviewerRole: 'reviewer', decision: 'approved' },
    ];
    const result = evaluateQuorum(requirement, approvals, 'author-1');
    expect(result.approvedCount).toBe(1);
    expect(result.satisfied).toBe(false);
  });

  it("excludes the author's own approval under separation of duties", () => {
    const approvals: CountedApproval[] = [
      { reviewerActorId: 'author-1', reviewerRole: 'reviewer', decision: 'approved' },
      { reviewerActorId: 'r2', reviewerRole: 'reviewer', decision: 'approved' },
    ];
    const result = evaluateQuorum(requirement, approvals, 'author-1');
    expect(result.approvedCount).toBe(1);
    expect(result.satisfied).toBe(false);
    expect(result.reasons.some((r) => r.includes('separation of duties'))).toBe(true);
  });

  it('excludes reviewers without an eligible role', () => {
    const approvals: CountedApproval[] = [
      { reviewerActorId: 'r1', reviewerRole: 'observer', decision: 'approved' },
      { reviewerActorId: 'r2', reviewerRole: 'reviewer', decision: 'approved' },
    ];
    const result = evaluateQuorum(requirement, approvals, 'author-1');
    expect(result.approvedCount).toBe(1);
  });

  it('ignores rejected and changes_requested decisions', () => {
    const approvals: CountedApproval[] = [
      { reviewerActorId: 'r1', reviewerRole: 'reviewer', decision: 'rejected' },
      { reviewerActorId: 'r2', reviewerRole: 'reviewer', decision: 'changes_requested' },
    ];
    const result = evaluateQuorum(requirement, approvals, 'author-1');
    expect(result.approvedCount).toBe(0);
  });
});
