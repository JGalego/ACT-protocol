# Formal Methods

## Status

**Implemented.** The authoritative description, with the exact invariants, mutants, results and limits, is [`formal/README.md`](../formal/README.md). Run it with `make verify-formal` (`scripts/formal/run-tlc.sh`).

## What Is Modeled

`spec/ACT-1.0.md` section 13 requires receipt-chain integrity, immutable history, acyclic lineage, approval-lifecycle safety, and authorized effective-intent transitions. The initial models checked single-record transition tables. A later code review found attribution forgery, key-id takeover, ledger identity loss on restart, and unauthorized intent selection. The models could not express those failures because they had no adversary or actor-permission model.

The adversarial models cover:

| Property family | Module |
| --- | --- |
| Attribution, key identity, revocation, artifact ownership | `WritePath` |
| Append-only receipt chain, immutable history, atomic append, duplicate suppression, under concurrency and crashes | `LedgerAppend` |
| Approval-lifecycle safety: authorization exactly when spec section 8.3 says | `ApprovalAuthorization` |
| Effective-intent transition safety, including who may select | `IntentAuthority` |
| Federation: no forged imports, accurate partial-history boundaries | `Federation` |
| Tenant isolation: no cross-tenant read, oracle, trust, sequence or administrator leak | `TenantIsolation` |
| Roles from signed assignments: only legitimate grants, scoped delegation, final revocation, no decision by a lapsed role | `RoleAssignment` |
| Import trust: events judged at the source's acceptance time, never the claimed time | `ImportTrustTime` |
| Witnessed checkpoints: no two endorsed histories conflict, up to the stated corrupt-witness bound | `Witness` |
| Acyclic lineage (discipline of the cycle check) and the single-record state machines | `AcyclicLineage`, `ApprovalLifecycle`, `KeyLifecycle`, ... |

## Tests and Model Checking

Hand-picked scenarios catch the bugs their author thought of. A model checker explores every interleaving of the adversary's actions within the bound and returns the shortest counterexample. Each of the bugs fixed in the review has a 3 to 10 step counterexample against the corresponding mutant in `formal/mutants/`. Unit tests remain necessary: the model is not the code, and the tests listed in `formal/README.md` ("Tying the models to the code") are what connect them.

## Toolchain

**TLA+/TLC.** The models describe sequences of adversarial actions. TLC explores bounded state spaces: a pass establishes no violation within those bounds, not a proof for all sizes. `formal/README.md` describes unbounded proofs, implementation-trace validation, pure-function proofs, and cryptographic analysis as follow-up work.

## Non-Normative

Nothing in this document is itself normative; `spec/state-machines.md` and `spec/ACT-1.0.md` remain the normative source.

## Unbounded proofs

A TLAPS proof could establish inductive invariants for unbounded numbers of principals, events, and workers. For `LedgerAppend`, these include `ReceiptChainIntegrity` and each worker's snapshot being a prefix of the log. TLAPS is distributed as an installer binary; verify its checksum and provenance and run it in an isolated environment before adding proof steps to CI. This repository does not download and execute that installer automatically.
