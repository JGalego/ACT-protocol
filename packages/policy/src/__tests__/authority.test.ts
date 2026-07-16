import { describe, expect, it } from 'vitest';
import { evaluateAuthoritySelection, type AuthorityPolicyDocument } from '../authority.js';

const policy: AuthorityPolicyDocument = {
  policy_id: 'ap1',
  policy_version: 'sha-256:' + '1'.repeat(64),
  scope: { project: 'act-protocol', branch: 'main' },
  authorized_roles: ['maintainer'],
  quorum: 2,
  separation_of_duties: true,
};

describe('evaluateAuthoritySelection', () => {
  it('rejects a request outside the policy scope', () => {
    const result = evaluateAuthoritySelection(policy, { project: 'other-project' }, [
      { actorId: 'a1', roles: ['maintainer'] },
    ]);
    expect(result.authorized).toBe(false);
  });

  it('rejects a branch outside the policy scope', () => {
    const result = evaluateAuthoritySelection(
      policy,
      { project: 'act-protocol', branch: 'feature-x' },
      [{ actorId: 'a1', roles: ['maintainer'] }],
    );
    expect(result.authorized).toBe(false);
  });

  it('is not authorized below quorum', () => {
    const result = evaluateAuthoritySelection(policy, { project: 'act-protocol', branch: 'main' }, [
      { actorId: 'a1', roles: ['maintainer'] },
    ]);
    expect(result.authorized).toBe(false);
  });

  it('is authorized once quorum of authorized-role distinct actors act', () => {
    const result = evaluateAuthoritySelection(policy, { project: 'act-protocol', branch: 'main' }, [
      { actorId: 'a1', roles: ['maintainer'] },
      { actorId: 'a2', roles: ['maintainer'] },
    ]);
    expect(result.authorized).toBe(true);
  });

  it('excludes actors without an authorized role', () => {
    const result = evaluateAuthoritySelection(policy, { project: 'act-protocol', branch: 'main' }, [
      { actorId: 'a1', roles: ['maintainer'] },
      { actorId: 'a2', roles: ['contributor'] },
    ]);
    expect(result.authorized).toBe(false);
    expect(result.reasons.some((r) => r.includes('excluded'))).toBe(true);
  });

  it('excludes the proposing actor from acting as their own authority under separation of duties', () => {
    const result = evaluateAuthoritySelection(
      policy,
      { project: 'act-protocol', branch: 'main' },
      [
        { actorId: 'proposer', roles: ['maintainer'] },
        { actorId: 'a2', roles: ['maintainer'] },
      ],
      'proposer',
    );
    expect(result.authorized).toBe(false);
  });

  it('does not double-count the same actor acting twice', () => {
    const result = evaluateAuthoritySelection(policy, { project: 'act-protocol', branch: 'main' }, [
      { actorId: 'a1', roles: ['maintainer'] },
      { actorId: 'a1', roles: ['maintainer'] },
    ]);
    expect(result.authorized).toBe(false);
  });
});
