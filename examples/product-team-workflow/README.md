# Example: Product Team Workflow

A product team moves from intent through requirements, implementation, and tests, to a policy-required approval (PROMPT.md's Example Applications item #2).

**Scenario** (`scenario.test.ts`): a product owner records an Intent; Requirements are derived through transformations; an engineer implements a Task, revises it after a failed test, and records a passing test. A quorum-1 approval policy is published, a reviewer approves the engineer's request, and a verification report is recorded.

Run it:

```bash
pnpm --filter @act/examples exec vitest run product-team-workflow
```

## Checks

- Signed envelopes are submitted over HTTP to an API instance backed by in-memory SQLite.
- `GET /v1/lineage/:id` traces the approval decision back through the revision and the implementation transformation to the requirements it consumed, and separately traces each requirement's own transformation back to the intent. (A `genesis` event's `causal_parents` must be empty per schema, so an artifact's link to the intent that motivated it lives in the `Transformation` record that produced it, not in the artifact's own event-graph ancestors -- lineage roots at genesis events by design.)
- `GET /v1/artifacts/:id/versions` and `GET /v1/artifacts/:id/diff` show the revision (`data.status: "in_progress" -> "done"` and an updated description).

## Equivalent CLI usage

The same Intent/Task/approval events can be recorded against a local embedded workspace with the `act` CLI instead of a running server:

```bash
act init
act intent create "Reduce checkout abandonment by simplifying the payment step."
act verify
```

The CLI uses a local ledger file; the API test uses a separate service ledger.
