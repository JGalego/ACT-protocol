import { describe, expect, it } from 'vitest';
import { evaluateApprovalRequirement } from '../evaluate.js';
import type { PolicyDocument } from '../types.js';

const policy: PolicyDocument = {
  policy_id: 'p1',
  policy_version: 'sha-256:' + '1'.repeat(64),
  kind: 'approval',
  name: 'test policy',
  rules: [
    {
      rule_id: 'require-approval-for-semantic-modification',
      when: { semantic_change_classification: ['semantic-modification'] },
      require: {
        approval: true,
        quorum: 1,
        reviewer_roles: ['reviewer'],
        separation_of_duties: true,
      },
    },
    {
      rule_id: 'require-extra-quorum-for-restricted',
      when: { sensitivity: ['restricted'] },
      require: { approval: true, quorum: 2 },
    },
  ],
};

describe('evaluateApprovalRequirement', () => {
  it('reports no requirement when no rule matches', () => {
    const result = evaluateApprovalRequirement(policy, {
      semanticChangeClassification: 'clarification',
    });
    expect(result.required).toBe(false);
    expect(result.matchedRuleIds).toEqual([]);
  });

  it('applies a single matching rule', () => {
    const result = evaluateApprovalRequirement(policy, {
      semanticChangeClassification: 'semantic-modification',
    });
    expect(result.required).toBe(true);
    expect(result.quorum).toBe(1);
    expect(result.reviewerRoles).toEqual(['reviewer']);
    expect(result.separationOfDuties).toBe(true);
    expect(result.matchedRuleIds).toEqual(['require-approval-for-semantic-modification']);
  });

  it('combines multiple matching rules conservatively (max quorum, union roles)', () => {
    const result = evaluateApprovalRequirement(policy, {
      semanticChangeClassification: 'semantic-modification',
      sensitivity: 'restricted',
    });
    expect(result.required).toBe(true);
    expect(result.quorum).toBe(2);
    expect(result.separationOfDuties).toBe(true);
    expect(result.matchedRuleIds.sort()).toEqual(
      ['require-approval-for-semantic-modification', 'require-extra-quorum-for-restricted'].sort(),
    );
  });

  it('does not match a rule when the context omits the field the rule keys on', () => {
    const result = evaluateApprovalRequirement(policy, {});
    expect(result.required).toBe(false);
  });

  it('reports required=false with a distinct reason when a rule matches but does not require approval', () => {
    const p: PolicyDocument = {
      ...policy,
      rules: [{ rule_id: 'log-only', when: { subject_kind: ['artifact'] }, require: {} }],
    };
    const result = evaluateApprovalRequirement(p, { subjectKind: 'artifact' });
    expect(result.required).toBe(false);
    expect(result.matchedRuleIds).toEqual(['log-only']);
    expect(result.reason).toContain('did not require approval');
  });

  it('matches on subject_kind and artifact_type when present', () => {
    const p: PolicyDocument = {
      ...policy,
      rules: [
        {
          rule_id: 'r',
          when: { subject_kind: ['artifact'], artifact_type: ['Intent'] },
          require: { approval: true, quorum: 1 },
        },
      ],
    };
    expect(
      evaluateApprovalRequirement(p, { subjectKind: 'artifact', artifactType: 'Intent' }).required,
    ).toBe(true);
    expect(
      evaluateApprovalRequirement(p, { subjectKind: 'artifact', artifactType: 'Task' }).required,
    ).toBe(false);
    expect(
      evaluateApprovalRequirement(p, { subjectKind: 'transformation', artifactType: 'Intent' })
        .required,
    ).toBe(false);
  });
});
