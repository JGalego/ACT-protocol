import { describe, expect, it } from 'vitest';
import type { KeyValidityResult } from '@act/crypto';
import type { ApprovalRequirementResult } from '@act/policy';
import type { ApprovalDecisionRecord } from '../approval.js';
import { evaluateApprovalAuthorization } from '../authorization.js';

/**
 * Differential test of `evaluateApprovalAuthorization` against an oracle
 * transcribed directly from spec/ACT-1.0.md section 8.3 and
 * spec/state-machines.md section 2, written in a deliberately different shape
 * (an existential over subsets of decisions, not a filter-then-count). The
 * same predicate is model-checked in formal/modules/ApprovalAuthorization.tla;
 * here it is exhaustively compared with the real code over every combination of
 * the small configuration space below.
 */

const NOW = '2026-06-01T00:00:00Z';
const SUBJECT = 'sha-256:cur';
const POLICY = 'sha-256:pol-v2';
const AUTHOR = 'author';

interface Attr {
  reviewer: 'r1' | 'r2' | 'author';
  role: 'reviewer' | 'other';
  decision: 'approved' | 'rejected';
  status: 'approved' | 'revoked';
  subjectCurrent: boolean;
  expired: boolean;
  keyGood: boolean;
  policyCurrent: boolean;
}

const REVIEWERS = ['r1', 'r2', 'author'] as const;
const ROLES = ['reviewer', 'other'] as const;
const DECISIONS = ['approved', 'rejected'] as const;
const STATUSES = ['approved', 'revoked'] as const;
const BOOLS = [true, false] as const;

function allAttrs(): Attr[] {
  const out: Attr[] = [];
  for (const reviewer of REVIEWERS)
    for (const role of ROLES)
      for (const decision of DECISIONS)
        for (const status of STATUSES)
          for (const subjectCurrent of BOOLS)
            for (const expired of BOOLS)
              for (const keyGood of BOOLS)
                for (const policyCurrent of BOOLS)
                  out.push({
                    reviewer,
                    role,
                    decision,
                    status,
                    subjectCurrent,
                    expired,
                    keyGood,
                    policyCurrent,
                  });
  return out;
}

function record(attr: Attr, index: number): ApprovalDecisionRecord {
  return {
    decisionId: `d${index}`,
    subjectVersionId: attr.subjectCurrent ? SUBJECT : 'sha-256:old',
    decision: attr.decision,
    reviewerActorId: attr.reviewer,
    reviewerKeyId: `key-${attr.reviewer}`,
    reviewerRole: attr.role,
    policyId: 'p',
    policyVersion: attr.policyCurrent ? POLICY : 'sha-256:pol-v1',
    issuedAt: '2026-01-01T00:00:00Z',
    expiresAt: attr.expired ? '2026-03-01T00:00:00Z' : '2027-01-01T00:00:00Z',
    status: attr.status,
  };
}

const keyValidity =
  (attrs: Attr[]) =>
  (d: ApprovalDecisionRecord): KeyValidityResult => {
    const attr = attrs[Number(d.decisionId.slice(1))]!;
    return attr.keyGood
      ? { statusAtTime: 'active', validForSigning: true, reason: 'ok' }
      : { statusAtTime: 'revoked', validForSigning: false, reason: 'revoked' };
  };

interface Req {
  quorum: number;
  separationOfDuties: boolean;
  reviewerRoles: string[];
}

/** The spec predicate: some set of decisions, each individually valid, with enough distinct eligible reviewers. */
function specAuthorized(attrs: Attr[], req: Req, allowDrift: boolean): boolean {
  const individuallyValid = (a: Attr) =>
    a.decision === 'approved' &&
    a.status === 'approved' &&
    a.subjectCurrent &&
    !a.expired &&
    a.keyGood &&
    (allowDrift || a.policyCurrent) &&
    (!req.separationOfDuties || a.reviewer !== AUTHOR) &&
    (req.reviewerRoles.length === 0 || req.reviewerRoles.includes(a.role));
  const n = attrs.length;
  for (let mask = 0; mask < 1 << n; mask++) {
    const chosen = attrs.filter((_, i) => (mask >> i) & 1);
    if (!chosen.every(individuallyValid)) continue;
    if (new Set(chosen.map((a) => a.reviewer)).size >= req.quorum) return true;
  }
  return req.quorum <= 0;
}

function requirement(req: Req): ApprovalRequirementResult {
  return {
    required: true,
    reason: 'test',
    quorum: req.quorum,
    reviewerRoles: req.reviewerRoles,
    separationOfDuties: req.separationOfDuties,
    matchedRuleIds: ['r'],
  };
}

const REQS: Req[] = [];
for (const quorum of [1, 2])
  for (const separationOfDuties of BOOLS)
    for (const reviewerRoles of [[], ['reviewer']] as string[][])
      REQS.push({ quorum, separationOfDuties, reviewerRoles });

function check(attrs: Attr[], req: Req, allowDrift: boolean) {
  const actual = evaluateApprovalAuthorization({
    requirement: requirement(req),
    decisions: attrs.map(record),
    authorActorId: AUTHOR,
    currentSubjectVersionId: SUBJECT,
    currentPolicyVersion: POLICY,
    now: NOW,
    keyValidityAtIssuance: keyValidity(attrs),
    allowPolicyVersionDrift: allowDrift,
  });
  const expected = specAuthorized(attrs, req, allowDrift);
  if (actual.authorized !== expected) {
    throw new Error(
      `mismatch: code=${actual.authorized} spec=${expected} req=${JSON.stringify(req)} drift=${allowDrift} attrs=${JSON.stringify(attrs)}`,
    );
  }
}

describe('evaluateApprovalAuthorization agrees with the spec predicate', () => {
  const attrs = allAttrs();

  it('exhaustively, for every one- and two-decision configuration', () => {
    let configurations = 0;
    for (const req of REQS) {
      for (const allowDrift of BOOLS) {
        for (const a of attrs) {
          check([a], req, allowDrift);
          configurations++;
        }
      }
    }
    // Two decisions: every ordered pair, every requirement, drift on and off.
    for (const req of REQS) {
      for (const a of attrs) {
        for (const b of attrs) {
          check([a, b], req, false);
          configurations++;
        }
      }
    }
    expect(configurations).toBeGreaterThan(100_000);
  }, 120_000);

  it('for seeded random configurations of three to five decisions', () => {
    let seed = 20261123;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let run = 0; run < 20_000; run++) {
      const n = 3 + Math.floor(next() * 3);
      const picked = Array.from({ length: n }, () => attrs[Math.floor(next() * attrs.length)]!);
      check(picked, REQS[Math.floor(next() * REQS.length)]!, next() < 0.3);
    }
  });

  it('does not require approval when the policy does not', () => {
    const result = evaluateApprovalAuthorization({
      requirement: { ...requirement(REQS[0]!), required: false, quorum: 0 },
      decisions: [],
      authorActorId: AUTHOR,
      currentSubjectVersionId: SUBJECT,
      currentPolicyVersion: POLICY,
      now: NOW,
      keyValidityAtIssuance: () => ({ statusAtTime: 'active', validForSigning: true, reason: '' }),
    });
    expect(result.authorized).toBe(true);
  });

  it('explains why a decision did not count', () => {
    const stale: Attr = {
      reviewer: 'r1',
      role: 'reviewer',
      decision: 'approved',
      status: 'revoked',
      subjectCurrent: false,
      expired: true,
      keyGood: false,
      policyCurrent: false,
    };
    const result = evaluateApprovalAuthorization({
      requirement: requirement(REQS[0]!),
      decisions: [record(stale, 0)],
      authorActorId: AUTHOR,
      currentSubjectVersionId: SUBJECT,
      currentPolicyVersion: POLICY,
      now: NOW,
      keyValidityAtIssuance: keyValidity([stale]),
    });
    expect(result.authorized).toBe(false);
    expect(result.validDecisionIds).toEqual([]);
    expect(result.rejected[0]!.findings.map((f) => f.ruleId).sort()).toEqual([
      'approval.expired',
      'approval.not-in-approved-state',
      'approval.policy-version-drift',
      'approval.reviewer-key-invalid',
      'approval.subject-mismatch',
    ]);
  });
});
