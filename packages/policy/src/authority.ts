export interface AuthorityPolicyDocument {
  policy_id: string;
  policy_version: string;
  scope: { project: string; branch?: string };
  authorized_roles: string[];
  quorum: number;
  separation_of_duties?: boolean;
}

export interface AuthorityActor {
  actorId: string;
  roles: string[];
}

export interface AuthoritySelectionResult {
  authorized: boolean;
  reasons: string[];
}

/**
 * Evaluates whether a set of actors selecting/merging/superseding an
 * effective Intent version satisfies the applicable authority policy's
 * role and quorum requirements, per ACT-1.0.md section 7.3. Until this
 * returns authorized, the caller MUST treat the conflict as unresolved --
 * it MUST NOT select a branch by write order or timestamp.
 */
export function evaluateAuthoritySelection(
  policy: AuthorityPolicyDocument,
  scope: { project: string; branch?: string },
  actingActors: AuthorityActor[],
  proposedIntentAuthorActorId?: string,
): AuthoritySelectionResult {
  const reasons: string[] = [];

  if (
    policy.scope.project !== scope.project ||
    (policy.scope.branch && policy.scope.branch !== scope.branch)
  ) {
    return {
      authorized: false,
      reasons: [
        `Authority policy scope ${JSON.stringify(policy.scope)} does not cover requested scope ${JSON.stringify(scope)}`,
      ],
    };
  }

  let eligible = actingActors.filter((a) =>
    a.roles.some((role) => policy.authorized_roles.includes(role)),
  );
  if (eligible.length < actingActors.length) {
    reasons.push(
      `excluded ${actingActors.length - eligible.length} actor(s) without an authorized role (${policy.authorized_roles.join(', ')})`,
    );
  }

  if (policy.separation_of_duties && proposedIntentAuthorActorId) {
    const before = eligible.length;
    eligible = eligible.filter((a) => a.actorId !== proposedIntentAuthorActorId);
    if (eligible.length < before) {
      reasons.push(
        'separation of duties: excluded the proposing actor from acting as their own authority',
      );
    }
  }

  const distinctActors = new Set(eligible.map((a) => a.actorId));
  const authorized = distinctActors.size >= policy.quorum;
  reasons.push(
    `${distinctActors.size} of ${policy.quorum} required distinct authorized actors present`,
  );

  return { authorized, reasons };
}
