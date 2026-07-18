# Formal Methods

Machine-checked TLA+ models of `spec/state-machines.md`'s six state machines, checked with the real TLC model checker (no mocked/simulated checker) via `make verify-formal` (`scripts/formal/run-tlc.sh`), which downloads a pinned, checksum-verified `tla2tools.jar` on first run — no Docker required, only Java 17+.

Supersedes `docs/formal-methods.md`'s "Deferred in this release" status: see `docs/adr/0001-phase-1-scope-and-deferred-work.md`'s amendment.

## Modules

One module per state machine in `spec/state-machines.md`, matching its structure 1:1 so the spec and the model can't silently drift. No top-level composed spec: none of the five Definition-of-Done invariants spans more than one state machine, so a monolithic composition would only multiply the state space for no additional checking benefit.

| Module | Checks | Cross-referenced unit tests |
| --- | --- | --- |
| `LedgerReceiptChain.tla` | `ReceiptChainIntegrity`, `ImmutableHistory` (spec section 6) | `packages/ledger/src/__tests__/receipts.test.ts` |
| `AcyclicLineage.tla` | `AcyclicLineage` (spec/ACT-1.0.md section 6.3) | `packages/ledger/src/__tests__/cycle.test.ts` |
| `ApprovalLifecycle.tla` | `TerminalStable`, `OnlyApprovedAuthorizes` (spec section 2) | `packages/verification/src/__tests__/approval.test.ts`, `packages/policy/src/__tests__/quorum.test.ts` |
| `IntentAuthority.tla` | `EffectiveIntentSafety` (spec section 4) | `packages/policy/src/__tests__/authority.test.ts` |
| `ChallengeLifecycle.tla` | `TypeOK`, terminal-state sanity only (spec section 3) | — |
| `KeyLifecycle.tla` | `TypeOK`, terminal-state sanity only (spec section 5) | `packages/crypto/src/__tests__/key-lifecycle.test.ts` (pure-function tests of the retroactive-doubt semantics, not a state machine) |
| `ArtifactVersionLifecycle.tla` | `TypeOK`, `NeverRegressesFromErased`, `SupersededStable` (spec section 1) | — |

`AcyclicLineage.tla` directly mirrors `packages/ledger/src/cycle.ts`'s `detectCycle`: only the four lineage-typed relations (`input`, `output`, `revision-of`, `merge-of`) participate; `approval-of`/`response-to` are excluded, matching the code exactly.

## Why these five (plus two informal ones) and not more

Only `ReceiptChainIntegrity`, immutable history, `AcyclicLineage`, `ApprovalLifecycleSafety`, and `EffectiveIntentSafety` are named in PROMPT.md's Definition of Done. `ChallengeLifecycle` and `KeyLifecycle` are modeled at `TypeOK` + terminal-state-sanity depth only — real, but intentionally not over-invested, consistent with the project's stated preference for a genuinely checked subset over a fabricated-breadth superset (ADR 0001).

## Non-vacuity

Every invariant/property above was checked against a real TLC run _and_ against a deliberately broken variant of its guard, confirming TLC actually finds the injected bug rather than passing vacuously:

- `AcyclicLineage`: removing the `<<child, parent>> \notin reach` guard produces a genuine 2-state cycle counterexample.
- `TerminalStable` (`ApprovalLifecycle`): adding a `cancelled -> requested` transition produces a genuine counterexample.
- `EffectiveIntentSafety` (`IntentAuthority`): removing the "supersede the prior effective version" step produces a genuine two-simultaneously-effective-versions counterexample.

These broken variants are not checked in (they were scratch files, deleted after confirming the failure) — see the commit history for the exact diffs used.

## Running

```bash
make verify-formal
# or directly:
bash scripts/formal/run-tlc.sh
```

Requires Java 17+. `formal/tools/tla2tools.jar` is downloaded once (pinned to v1.7.4, SHA-256-verified) and gitignored; subsequent runs reuse it. Each module's constants are deliberately small (3-4 elements) — these are finite-state sanity/safety checks proving the sequencing logic is sound, not an attempt to exhaustively model the full protocol's state space.
