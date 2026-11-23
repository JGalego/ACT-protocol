# Formal Methods

## Status

**Implemented.** The authoritative description, with the exact invariants, mutants, results and limits, is [`formal/README.md`](../formal/README.md). Run it with `make verify-formal` (`scripts/formal/run-tlc.sh`).

This page records the scoping rationale and the toolchain choice.

## What Is Modeled

`spec/ACT-1.0.md` section 13 requires, at minimum: append-only receipt-chain integrity, immutable history, acyclic lineage, approval-lifecycle safety, and prevention of an unauthorized effective-intent transition. The first version of `formal/` modeled each state machine of `spec/state-machines.md` as a single-record transition table and checked those five names. A review of the project then found real defects in the very properties those models claimed to cover (events attributable to an actor who did not sign them, a key id that could be taken over, a ledger identity lost on restart, an effective-intent transition open to anyone). The old models passed because they contained no adversary and no notion of _who_ may take a step: they could not express the failure.

The models now state the adversary explicitly, and cover what actually failed:

| Property family | Module |
| --- | --- |
| Attribution, key identity, revocation, artifact ownership | `WritePath` |
| Append-only receipt chain, immutable history, atomic append, duplicate suppression, under concurrency and crashes | `LedgerAppend` |
| Approval-lifecycle safety: authorization exactly when spec section 8.3 says | `ApprovalAuthorization` |
| Effective-intent transition safety, including who may select | `IntentAuthority` |
| Federation: no forged imports, accurate partial-history boundaries | `Federation` |
| Tenant isolation: no cross-tenant read, oracle, trust, sequence or administrator leak | `TenantIsolation` |
| Roles from signed assignments: only legitimate grants, scoped delegation, final revocation, no decision by a lapsed role | `RoleAssignment` |
| Acyclic lineage (discipline of the cycle check) and the single-record state machines | `AcyclicLineage`, `ApprovalLifecycle`, `KeyLifecycle`, ... |

## Why Unit Tests Are Not a Substitute

Hand-picked scenarios catch the bugs their author thought of. A model checker explores every interleaving of the adversary's actions within the bound and returns the shortest counterexample. Each of the bugs fixed in the review has a 3 to 10 step counterexample against the corresponding mutant in `formal/mutants/`. Unit tests remain necessary: the model is not the code, and the tests listed in `formal/README.md` ("Tying the models to the code") are what connect them.

## Toolchain

**TLA+/TLC.** The invariants are about sequences of actions by an adversary over time, which is TLA+'s strength. TLC is bounded and explicit-state, so a pass means "no violation within the bounds", not a proof for all sizes; `formal/README.md` lists what a stronger proof would take (TLAPS or Apalache for unbounded inductive invariants, trace validation against the implementation, Dafny/Lean for the pure functions, Tamarin/ProVerif for the cryptographic layer).

## Non-Normative

Nothing in this document is itself normative; `spec/state-machines.md` and `spec/ACT-1.0.md` remain the normative source.
