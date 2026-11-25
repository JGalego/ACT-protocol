# Example: Safety-Critical Workflow with an Unresolved Challenge

A safety-critical workflow with strict separation of duties, formal evidence, and an unresolved challenge that prevents release (PROMPT.md's Example Applications item #6).

**Scenario** (`scenario.test.ts`): an engineer changes braking-control timing and an independent safety approver approves a recorded `formal-proof` result. An auditor challenges its coverage. The readiness check reports **not ready** until the auditor records a `challenge_resolved` event, then reports **ready**. The evidence is illustrative; this test does not verify braking-control safety.

Run it:

```bash
pnpm --filter @act/examples exec vitest run safety-critical-challenge
```

## Checks

- `assessReleaseReadiness` evaluates the recorded challenge state. A challenge blocks release through this example's policy, without preventing subsequent ledger writes.
- The original `challenge_raised` event remains unchanged. The check groups events by challenge artifact id and uses the highest-sequence record for current status.
- `evaluateApprovalRequirement`/`evaluateQuorum` enforce `reviewer_roles: ["safety-approver"]` and `separation_of_duties: true`.

## Equivalent CLI usage

`act verify` checks a local workspace. A service-ledger readiness check can use `GET /v1/challenges` and apply its own release policy.
