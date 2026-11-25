---
title: Examples
description: An animated Explorer walkthrough and executable API scenarios.
---

The Explorer supplies the animated walkthrough. API scenarios under `examples/` submit signed envelopes to in-memory SQLite-backed service instances and check policies, approvals, revisions, evidence, and verification results.

| # | Example | Distinctive feature |
| --- | --- | --- |
| 1 | A single human collaborating with an AI coding assistant | The animated support-triage walkthrough. See the [live Explorer](/explorer/) |
| 2 | Product team: intent → requirements → implementation → tests → approval | A revision after a failed test run |
| 3 | AI-agent group producing competing proposals and a reviewed merge | Both proposals stay on the ledger; only the chosen one is carried forward |
| 4 | Enterprise: OIDC identities, quorum approval, restricted evidence, audit export | JWT verification and `@act/policy` quorum evaluation |
| 5 | Open-source collaboration with external contributions and signed bundle federation | Independent API instances exchanging a bundle over HTTP |
| 6 | Safety-critical workflow with separation of duties, formal evidence, and an unresolved challenge | A release-readiness check using the latest recorded challenge status |

## Running them

```bash
# API scenarios
pnpm --filter @act/examples run test

# Just one
pnpm --filter @act/examples exec vitest run product-team-workflow
```

:::tip[Writing an integration]

Each API example is a Vitest spec under `examples/<name>/`. Use the closest scenario as a reference for request order and payloads. Run the Explorer separately with `pnpm run dev:explorer`.

:::

## Scenario coverage

- **Product team workflow**: a failed test leads to a Task revision, followed by a passing test and policy-required approval.
- **Competing AI proposals**: a human Decision selects one proposal; both remain on the ledger.
- **Enterprise OIDC quorum**: JWTs from the local OIDC provider exercise the production verifier. `@act/policy` checks quorum and separation of duties.
- **Open-source federation**: the maintainer pulls a contribution from an independent ledger over HTTP and verifies it against local trust policy.
- **Safety-critical challenge**: a recorded challenge blocks the example's readiness check until a resolution is recorded. The formal evidence is illustrative; the test checks how ACT records and uses it.

## Shared fixtures

[`examples/shared/fixtures.ts`](https://github.com/JGalego/ACT-protocol/blob/main/examples/shared/fixtures.ts) provides artifact and envelope builders plus HTTP server helpers. Payloads follow the schemas and their positive fixtures.
