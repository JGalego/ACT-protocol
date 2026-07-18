# Example: Product Team Workflow

A product team moves from intent through requirements, implementation, and tests, to a policy-required approval (PROMPT.md's Example Applications item #2).

**Scenario** (`scenario.test.ts`): a product owner records an Intent; two Requirements are derived from it, each via a `Transformation` event; an engineer implements a Task; the first test run fails; the engineer revises the Task (the required "at least one revision"); the second test run passes; a reviewer publishes an approval Policy (quorum 1); the engineer requests approval; the reviewer approves; a verification report is recorded.

Run it:

```bash
pnpm --filter @act/examples exec vitest run product-team-workflow
```

## What it proves

- Real signed envelopes, submitted over real HTTP to a real (in-memory) `services/api` instance -- not mocked.
- `GET /v1/lineage/:id` traces the approval decision back through the revision and the implementation transformation to the requirements it consumed, and separately traces each requirement's own transformation back to the intent. (A `genesis` event's `causal_parents` must be empty per schema, so an artifact's link to the intent that motivated it lives in the `Transformation` record that produced it, not in the artifact's own event-graph ancestors -- lineage roots at genesis events by design.)
- `GET /v1/artifacts/:id/versions` and `GET /v1/artifacts/:id/diff` show the real revision and exactly what changed (`data.status: "in_progress" -> "done"`, plus the updated description).

## Equivalent CLI usage

The same Intent/Task/approval events can be recorded against a local embedded workspace with the `act` CLI instead of a running server:

```bash
act init
act intent create "Reduce checkout abandonment by simplifying the payment step."
act verify
```

`apps/cli`'s `act` commands and `services/api`'s HTTP routes operate on independent ledger instances (a local file vs. a server-side one) -- this example uses the HTTP path so its outcome is verifiable via `/v1/lineage`, `/v1/artifacts/:id/versions`, and `/v1/artifacts/:id/diff` in one assertion suite.
