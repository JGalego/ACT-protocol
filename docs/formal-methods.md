# Formal Methods

## Status

**Deferred in this release** — see
`docs/adr/0001-phase-1-scope-and-deferred-work.md` and
`docs/roadmap.md`. This document specifies what the eventual
machine-checked model must cover and how it plugs into `make
verify-integration`, so the work is well-scoped for whoever picks it up.

## What Must Be Modeled

`spec/state-machines.md` already gives the normative, implementation-
independent state machines; `formal/` is where they become machine-
checkable. At minimum, per `PROMPT.md`:

1. **Append-only receipt-chain integrity** — `spec/state-machines.md`
   section 6's invariant that `receipt_n.previous_receipt_digest ==
digest(receipt_{n-1})` for every `n > 0`, and that `sequence` is
   contiguous. This repository's own `ReceiptChainIntegrity` name for
   this invariant appears in `spec/semantic-model.md` section 4 and is
   unit-tested (not model-checked) in
   `packages/ledger/src/__tests__/receipts.test.ts`.
2. **Immutable history** — an accepted event's canonical payload never
   changes.
3. **Acyclic lineage** — `spec/semantic-model.md`'s `AcyclicLineage`
   invariant, unit-tested (not model-checked) in
   `packages/ledger/src/__tests__/cycle.test.ts` and
   `ledger.test.ts`.
4. **Approval lifecycle safety** — `spec/semantic-model.md`'s
   `ApprovalLifecycleSafety`: no reachable state authorizes an action
   without a currently valid, non-expired, non-revoked, quorum-satisfying
   approval. Partially covered by unit tests in
   `packages/verification/src/__tests__/approval.test.ts` and
   `packages/policy/src/__tests__/quorum.test.ts`, but those test
   specific scenarios, not every reachable state.
5. **Effective-intent transition safety** — `spec/semantic-model.md`'s
   `EffectiveIntentSafety`: at most one Intent version is effective per
   (project, branch), and a transition to effective requires an
   authority-policy-satisfying event. Covered at the unit level by
   `packages/policy/src/__tests__/authority.test.ts`.

## Why Unit Tests Are Not a Substitute

Each invariant above is exercised by hand-picked scenarios today. A model
checker (TLA+ via TLC, or Alloy) explores the full reachable state space
up to a bound, catching a violation that no test author thought to write
— which is the entire point of formal verification. This repository's
current unit tests are necessary but not sufficient evidence for the
Definition of Done's "machine-checkable formal model" requirement.

## Intended Toolchain

- **TLA+/TLC** is recommended over Alloy for this protocol, since the
  invariants above are fundamentally about sequences of events over time
  (temporal properties), which is TLA+'s strength.
- The model should take `spec/state-machines.md`'s five state machines
  (Artifact Version Lifecycle, Approval Lifecycle, Challenge Lifecycle,
  Intent Authority State, Key Lifecycle) plus the Ledger Receipt Chain as
  its starting modules, matching the document's structure 1:1 so the
  spec and the model never drift silently.
- `make verify-integration` should run the model checker in a container
  (per `PROMPT.md`'s "using a container when host tooling is
  unavailable") once this exists, with a bounded exploration depth
  documented alongside the results.

## Non-Normative

Nothing in this document is itself normative; `spec/state-machines.md`
and `spec/ACT-1.0.md` remain the normative source. This document only
scopes the verification work.
