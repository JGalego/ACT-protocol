# Example Applications

Six executable, seeded examples demonstrating the full ACT protocol lifecycle end-to-end, per `PROMPT.md`'s Example Applications section. Each includes signed fixtures, policies, assumptions, evidence, approvals, at least one revision (where applicable), verification output, and assertions proving the expected outcome -- against a real (in-memory) `services/api` instance, not mocked.

| # | Example | Directory | Distinctive feature |
| --- | --- | --- | --- |
| 1 | A single human collaborating with an AI coding assistant | `apps/explorer` | The animated support-triage walkthrough; see the root README |
| 2 | Product team: intent → requirements → implementation → tests → approval | [`product-team-workflow/`](product-team-workflow/) | A real revision after a failed test run |
| 3 | AI-agent group producing competing proposals and a reviewed merge | [`competing-ai-proposals/`](competing-ai-proposals/) | Both proposals stay on the ledger; only the chosen one is carried forward |
| 4 | Enterprise: OIDC identities, quorum approval, restricted evidence, audit export | [`enterprise-oidc-quorum/`](enterprise-oidc-quorum/) | Real production OIDC/JWT auth (not the local dev bearer scheme); real `@act/policy` quorum evaluation |
| 5 | Open-source collaboration with external contributions and signed bundle federation | [`open-source-federation/`](open-source-federation/) | Two independent `services/api` instances; real peer-to-peer federation pull |
| 6 | Safety-critical workflow with separation of duties, formal evidence, and an unresolved challenge | [`safety-critical-challenge/`](safety-critical-challenge/) | A release-readiness check that reads real (immutable, append-only) ledger state |

Run all of them:

```bash
pnpm --filter @act/examples run test
```

Run one:

```bash
pnpm --filter @act/examples exec vitest run product-team-workflow
```

## Shared fixtures

[`shared/fixtures.ts`](shared/fixtures.ts) generalizes the envelope-building helpers proven in `services/api/src/__tests__/helpers.ts` across every artifact type an example needs (Intent, Requirement, Task, Test, AIProposal, Decision, Evidence, Policy, ApprovalRequest/Decision, Challenge, VerificationReport, Transformation), plus real HTTP server helpers (`makeListeningServer`, `registerActorOn`, `postEnvelope`). Every payload shape matches a real schema and, where one exists, the real positive fixture under `schemas/**/fixtures/positive/` -- nothing here is hand-derived without a schema-shaped source of truth.
