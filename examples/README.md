# Example Applications

Seeded examples from `PROMPT.md`: the animated Explorer walkthrough and API scenarios. The API tests submit signed envelopes to in-memory SQLite-backed service instances and check policies, approvals, revisions, evidence, and verification results.

| # | Example | Directory | Distinctive feature |
| --- | --- | --- | --- |
| 1 | A single human collaborating with an AI coding assistant | `apps/explorer` | The animated support-triage walkthrough; see the root README |
| 2 | Product team: intent → requirements → implementation → tests → approval | [`product-team-workflow/`](product-team-workflow/) | A revision after a failed test run |
| 3 | AI-agent group producing competing proposals and a reviewed merge | [`competing-ai-proposals/`](competing-ai-proposals/) | Both proposals stay on the ledger; only the chosen one is carried forward |
| 4 | Enterprise: OIDC identities, quorum approval, restricted evidence, audit export | [`enterprise-oidc-quorum/`](enterprise-oidc-quorum/) | JWT verification and `@act/policy` quorum evaluation |
| 5 | Open-source collaboration with external contributions and signed bundle federation | [`open-source-federation/`](open-source-federation/) | Independent API instances exchanging a bundle over HTTP |
| 6 | Safety-critical workflow with separation of duties, formal evidence, and an unresolved challenge | [`safety-critical-challenge/`](safety-critical-challenge/) | A release-readiness check using the latest recorded challenge status |

Run the API scenarios:

```bash
pnpm --filter @act/examples run test
```

Run one:

```bash
pnpm --filter @act/examples exec vitest run product-team-workflow
```

## Shared fixtures

[`shared/fixtures.ts`](shared/fixtures.ts) provides artifact and envelope builders plus HTTP helpers (`makeListeningServer`, `registerActorOn`, `postEnvelope`). Payloads follow the schemas and their positive fixtures. Run the animated walkthrough separately with `pnpm run dev:explorer`.
