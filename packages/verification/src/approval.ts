import type { KeyValidityResult } from '@act/crypto';
import { finding, type Finding } from './findings.js';

export interface ApprovalDecisionRecord {
  decisionId: string;
  subjectVersionId: string;
  decision: 'approved' | 'rejected' | 'changes_requested';
  reviewerActorId: string;
  reviewerKeyId: string;
  reviewerRole: string;
  policyId: string;
  policyVersion: string;
  issuedAt: string;
  expiresAt: string | null;
  status:
    | 'requested'
    | 'approved'
    | 'rejected'
    | 'changes_requested'
    | 'cancelled'
    | 'expired'
    | 'revoked'
    | 'superseded';
}

export interface ApprovalValidityCheckParams {
  decision: ApprovalDecisionRecord;
  currentSubjectVersionId: string;
  currentPolicyVersion: string;
  reviewerKeyValidityAtIssuance: KeyValidityResult;
  now: string;
}

/**
 * Checks whether an Approval Decision is currently valid for authorizing an
 * action on a given subject version, per ACT-1.0.md section 8.3: subject
 * digest match, status, expiry, and reviewer key status are all evaluated
 * and reported independently as findings (never collapsed into one flag).
 * A revised subject version does NOT inherit approval automatically.
 */
export function checkApprovalValidity(params: ApprovalValidityCheckParams): Finding[] {
  const {
    decision,
    currentSubjectVersionId,
    currentPolicyVersion,
    reviewerKeyValidityAtIssuance,
    now,
  } = params;
  const findings: Finding[] = [];

  if (decision.subjectVersionId !== currentSubjectVersionId) {
    findings.push(
      finding({
        ruleId: 'approval.subject-mismatch',
        severity: 'critical',
        resultKind: 'mechanical',
        affectedRecords: [decision.decisionId],
        evidence: [decision.subjectVersionId, currentSubjectVersionId],
        explanation: `Approval decision ${decision.decisionId} was issued for subject version ${decision.subjectVersionId}, not the current version ${currentSubjectVersionId}. A revised version does not inherit a prior approval.`,
        remediation: 'Request a new approval for the current subject version.',
      }),
    );
  }

  if (decision.status !== 'approved') {
    findings.push(
      finding({
        ruleId: 'approval.not-in-approved-state',
        severity: 'high',
        resultKind: 'mechanical',
        affectedRecords: [decision.decisionId],
        evidence: [decision.status],
        explanation: `Approval decision ${decision.decisionId} is in status '${decision.status}', not 'approved'.`,
        remediation: 'Do not treat this decision as a currently valid authorization.',
      }),
    );
  }

  if (decision.expiresAt && Date.parse(now) > Date.parse(decision.expiresAt)) {
    findings.push(
      finding({
        ruleId: 'approval.expired',
        severity: 'high',
        resultKind: 'mechanical',
        affectedRecords: [decision.decisionId],
        evidence: [decision.expiresAt],
        explanation: `Approval decision ${decision.decisionId} expired at ${decision.expiresAt}, before the current time ${now}.`,
        remediation: 'Request a fresh approval.',
      }),
    );
  }

  if (decision.policyVersion !== currentPolicyVersion) {
    findings.push(
      finding({
        ruleId: 'approval.policy-version-drift',
        severity: 'medium',
        resultKind: 'policy',
        affectedRecords: [decision.decisionId],
        evidence: [decision.policyVersion, currentPolicyVersion],
        explanation: `Approval decision ${decision.decisionId} was issued under policy version ${decision.policyVersion}, but the currently applicable policy version is ${currentPolicyVersion}.`,
        remediation:
          'Confirm whether the applicable policy explicitly permits carrying forward approvals issued under a prior policy version; if not, request a new approval.',
      }),
    );
  }

  if (!reviewerKeyValidityAtIssuance.validForSigning) {
    findings.push(
      finding({
        ruleId: 'approval.reviewer-key-invalid',
        severity: 'critical',
        resultKind: 'mechanical',
        affectedRecords: [decision.decisionId],
        evidence: [decision.reviewerKeyId],
        explanation: `The reviewer's signing key was '${reviewerKeyValidityAtIssuance.statusAtTime}' (${reviewerKeyValidityAtIssuance.reason}), not issued/active, at the time this decision was issued.`,
        remediation:
          'Treat this approval as unverifiable; obtain a new approval from a currently valid key.',
      }),
    );
  }

  return findings;
}
