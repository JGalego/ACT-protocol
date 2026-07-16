import { describe, expect, it } from 'vitest';
import type { KeyValidityResult } from '@act/crypto';
import { checkApprovalValidity, type ApprovalDecisionRecord } from '../approval.js';

const validKey: KeyValidityResult = {
  statusAtTime: 'active',
  validForSigning: true,
  reason: 'active',
};
const invalidKey: KeyValidityResult = {
  statusAtTime: 'revoked',
  validForSigning: false,
  reason: 'revoked',
};

const baseDecision: ApprovalDecisionRecord = {
  decisionId: 'd1',
  subjectVersionId: 'sha-256:' + '1'.repeat(64),
  decision: 'approved',
  reviewerActorId: 'reviewer-1',
  reviewerKeyId: 'ed25519:aaaa',
  reviewerRole: 'reviewer',
  policyId: 'p1',
  policyVersion: 'sha-256:' + '2'.repeat(64),
  issuedAt: '2026-01-01T00:00:00Z',
  expiresAt: null,
  status: 'approved',
};

describe('checkApprovalValidity', () => {
  it('produces no findings for a fully valid, current approval', () => {
    const findings = checkApprovalValidity({
      decision: baseDecision,
      currentSubjectVersionId: baseDecision.subjectVersionId,
      currentPolicyVersion: baseDecision.policyVersion,
      reviewerKeyValidityAtIssuance: validKey,
      now: '2026-01-02T00:00:00Z',
    });
    expect(findings).toEqual([]);
  });

  it('flags a subject-version mismatch', () => {
    const findings = checkApprovalValidity({
      decision: baseDecision,
      currentSubjectVersionId: 'sha-256:' + '9'.repeat(64),
      currentPolicyVersion: baseDecision.policyVersion,
      reviewerKeyValidityAtIssuance: validKey,
      now: '2026-01-02T00:00:00Z',
    });
    expect(findings.some((f) => f.ruleId === 'approval.subject-mismatch')).toBe(true);
  });

  it('flags a non-approved status', () => {
    const findings = checkApprovalValidity({
      decision: { ...baseDecision, status: 'revoked' },
      currentSubjectVersionId: baseDecision.subjectVersionId,
      currentPolicyVersion: baseDecision.policyVersion,
      reviewerKeyValidityAtIssuance: validKey,
      now: '2026-01-02T00:00:00Z',
    });
    expect(findings.some((f) => f.ruleId === 'approval.not-in-approved-state')).toBe(true);
  });

  it('flags an expired approval', () => {
    const findings = checkApprovalValidity({
      decision: { ...baseDecision, expiresAt: '2026-01-01T12:00:00Z' },
      currentSubjectVersionId: baseDecision.subjectVersionId,
      currentPolicyVersion: baseDecision.policyVersion,
      reviewerKeyValidityAtIssuance: validKey,
      now: '2026-01-02T00:00:00Z',
    });
    expect(findings.some((f) => f.ruleId === 'approval.expired')).toBe(true);
  });

  it('does not flag an approval before its expiry', () => {
    const findings = checkApprovalValidity({
      decision: { ...baseDecision, expiresAt: '2026-06-01T00:00:00Z' },
      currentSubjectVersionId: baseDecision.subjectVersionId,
      currentPolicyVersion: baseDecision.policyVersion,
      reviewerKeyValidityAtIssuance: validKey,
      now: '2026-01-02T00:00:00Z',
    });
    expect(findings.some((f) => f.ruleId === 'approval.expired')).toBe(false);
  });

  it('flags a policy-version drift as a policy-kind finding', () => {
    const findings = checkApprovalValidity({
      decision: baseDecision,
      currentSubjectVersionId: baseDecision.subjectVersionId,
      currentPolicyVersion: 'sha-256:' + '3'.repeat(64),
      reviewerKeyValidityAtIssuance: validKey,
      now: '2026-01-02T00:00:00Z',
    });
    const f = findings.find((f) => f.ruleId === 'approval.policy-version-drift');
    expect(f).toBeDefined();
    expect(f!.resultKind).toBe('policy');
  });

  it('flags an invalid reviewer key', () => {
    const findings = checkApprovalValidity({
      decision: baseDecision,
      currentSubjectVersionId: baseDecision.subjectVersionId,
      currentPolicyVersion: baseDecision.policyVersion,
      reviewerKeyValidityAtIssuance: invalidKey,
      now: '2026-01-02T00:00:00Z',
    });
    expect(findings.some((f) => f.ruleId === 'approval.reviewer-key-invalid')).toBe(true);
  });
});
