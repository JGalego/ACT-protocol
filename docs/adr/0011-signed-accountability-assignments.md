# ADR 0011: Roles Come from Signed Accountability Assignments

## Status

Accepted. Amends ADR 0009 (roles for authority evaluation were operator-asserted).

## Context

Selecting or merging an effective intent is the one transition spec section 7.3 reserves to an authority policy, and a policy names _roles_ ("approver", "owner") and a quorum. Which actor holds which role came from `actorRoles` in the operator's `ACT_AUTHORITY_POLICY_FILE`. That is outside the log:

- nothing records who granted a role, when, under what authority, or that it was later taken away;
- an auditor replaying the ledger cannot tell why a selection was authorized;
- changing roles means redeploying configuration, and a stale file silently changes who may decide;
- the protocol already defines the right record. `AccountabilityAssignment` (spec section 8.4) has `role`, `assignee`, `scope`, `issuer`, `authority`, `start_time`, `end_time` and `status`, and `accountability_assigned` is a defined event type, but nothing accepted or used it.

## Decision

**Roles are derived from signed assignments in the tenant's own ledger, and from nothing else.** `actorRoles` is removed; a configuration file that still contains it makes the server refuse to start, naming the replacement. The authority _policy_ (which roles may decide, the quorum, separation of duties) stays operator configuration: it is policy, not a statement about people.

**One event type, versions of one artifact.** An assignment is an artifact whose versions are recorded by `accountability_assigned` events. The first version has `status: active`. Ending or revoking it is a later version of the same artifact (a `revision-of` its predecessor) with `status` `ended` or `revoked`, so the history of who held what is the artifact's lineage. A revision may change only `status` and `end_time`; `role`, `assignee`, `scope` and `issuer` are fixed for the life of the assignment, and `ended` and `revoked` are terminal (a new grant is a new assignment).

**Who may grant.** The event actor must be the assignment's `issuer`, and one of:

1. an administrator of the tenant (`ACT_ADMIN_ACTORS`, ADR 0010), who may assign any role in any scope; this is the root of trust and is how roles are bootstrapped; or
2. an actor holding an active `owner` assignment for exactly that scope, who may assign any role in that scope, but never to themselves (an owner cannot widen their own authority).

The assignee must be an actor with at least one registered key in the tenant, so a role attaches to someone who can actually sign. **Who may end one:** its issuer, the assignee (resigning), a tenant administrator, or an active owner of its scope.

**When a role is held.** At time _T_ an actor holds a role for a scope if the latest version of some assignment names them, has `status: active`, and `T` falls in `[max(start_time, accepted_at of the version that granted it), end_time)`. The grant time is ledger-observed, so an assignment cannot be backdated to authorize an earlier decision. Evaluation for a new selection uses the time it is accepted. Scope is matched exactly against the authority policy's project.

**Only natively accepted assignments count.** An assignment that arrived through a federation bundle is recorded but confers no role: a peer's statement about its own people is not local authority (spec/federation.md section 3, ADR 0009). Grants are authorized when they are accepted, against the administrators and owners then in force; later demoting an administrator does not retroactively void what they granted, but any administrator can end it.

**A projection, not a table.** `RoleRegistry` is computed from the log like `KeyRegistry`: replaying the native assignment events rebuilds it, so a restart or another replica yields the same roles. The same pure function validates a request before it is appended and re-applies the structural rules (version chain, immutable fields, terminal states) on replay. The authorization check is a parameter: the write path supplies the real one, replay supplies none, because the administrators in force at the time are not recorded in the log.

**API.** `POST /v1/assignments` accepts `accountability_assigned` events. `GET /v1/assignments` lists assignments (filter by `actor`, `scope`, `active`), and `GET /v1/assignments/{id}` returns one assignment's version history. All are per tenant.

## Verification

`formal/modules/RoleAssignment.tla` models corrupt principals who grant, end and decide, and checks that every held role traces to an administrator through legitimate grants, that no owner grants outside their scope or to themselves, that ended, revoked and expired assignments confer nothing, and that an intent is selected only by actors holding an authorized role at that moment; mutants remove each guard. A differential unit test and the real-API cases in `hardening.test.ts` pin the code to it.

## Consequences

- Who may decide is auditable from the log: every grant names its issuer and is signed. Revocation takes effect for the next decision and leaves a record.
- Breaking: deployments using `actorRoles` must replace it with assignments (an administrator issues the first ones) before upgrading.
- The root of trust is still the operator's `ACT_ADMIN_ACTORS`. Making administrators themselves ledger-derived (so that adding one is also an audited, multi-party act) is future work.
- Roles are evaluated when a decision is accepted. Re-evaluating an old decision "as of then" on import is the separate question of trust at signing time.
