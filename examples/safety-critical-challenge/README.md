# Example: Safety-Critical Workflow with an Unresolved Challenge

A safety-critical workflow with strict separation of duties, formal evidence, and an unresolved challenge that prevents release (PROMPT.md's Example Applications item #6).

**Scenario** (`scenario.test.ts`): a firmware engineer changes braking-control timing; an independent safety approver (never the implementer -- separation of duties) reviews formally-verified evidence (`method: "formal-proof"`) and approves; a safety auditor then raises a `Challenge` disputing a gap in that formal proof's coverage; a release-readiness check correctly reports **not ready** while the challenge's status is `open`; the auditor later records a real `challenge_resolved` event, after which the same check reports **ready**.

Run it:

```bash
pnpm --filter @act/examples exec vitest run safety-critical-challenge
```

## What it proves

- The ACT ledger is an append-only record, not a gatekeeper -- it never refuses to record a fact. "Blocking release" is therefore a release-readiness check reading real ledger state, not the ledger rejecting a write. `assessReleaseReadiness` in this test is exactly that check.
- Because events are immutable, a resolved challenge's original `challenge_raised` record still says `status: "open"` forever -- the check correctly groups challenge events by artifact id and reads only the highest-sequence (most recent) record per challenge, matching how real release tooling would have to read this ledger.
- The approval's separation-of-duties requirement (`reviewer_roles: ["safety-approver"]`, `separation_of_duties: true`) is real policy data, evaluated the same way the enterprise-quorum example's policy is (see `@act/policy`'s `evaluateApprovalRequirement`/`evaluateQuorum`).

## Equivalent CLI usage

`act verify` runs the same integrity/lineage/approval-validity checks this repository ships against a local embedded workspace; a real release-readiness check like this example's would be a thin script layered on top of `act verify`'s or `GET /v1/challenges`'s output, not a new ledger primitive.
