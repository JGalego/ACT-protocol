---
title: Examples
description: Six executable, seeded examples covering the full ACT protocol lifecycle, each running against a real API instance.
---

Six executable, seeded examples demonstrate the full ACT protocol lifecycle end-to-end. Each includes signed fixtures, policies, assumptions, evidence, approvals, at least one revision (where applicable), verification output, and assertions proving the expected outcome — against a real (in-memory) `services/api` instance, never mocked.

| # | Example | Distinctive feature |
| --- | --- | --- |
| 1 | A single human collaborating with an AI coding assistant | The animated support-triage walkthrough — see the [live Explorer](/explorer/) |
| 2 | Product team: intent → requirements → implementation → tests → approval | A real revision after a failed test run |
| 3 | AI-agent group producing competing proposals and a reviewed merge | Both proposals stay on the ledger; only the chosen one is carried forward |
| 4 | Enterprise: OIDC identities, quorum approval, restricted evidence, audit export | Real production OIDC/JWT auth (not the local dev bearer scheme); real `@act/policy` quorum evaluation |
| 5 | Open-source collaboration with external contributions and signed bundle federation | Two independent `services/api` instances; real peer-to-peer federation pull |
| 6 | Safety-critical workflow with separation of duties, formal evidence, and an unresolved challenge | A release-readiness check that reads real (immutable, append-only) ledger state |

## Running them

```bash
# All six
pnpm --filter @act/examples run test

# Just one
pnpm --filter @act/examples exec vitest run product-team-workflow
```

:::tip[Reading these before writing your own integration] Each example lives under `examples/<name>/` as a single, readable Vitest spec — start from whichever one's shape is closest to what you're building, rather than re-deriving the request sequence from `spec/ACT-1.0.md` by hand. :::

## What each one proves

- **Product team workflow** — intent → requirements → implementation → tests → policy-required approval, with one real revision after the implementation's first test run fails.
- **Competing AI proposals** — two independent AI agents each propose a different approach to the same intent; a human reviewer records a Decision selecting one. The rejected proposal is never deleted — it stays on the ledger, attributed and inspectable.
- **Enterprise OIDC quorum** — actors authenticate via real JWTs issued by the deterministic dev OIDC provider (not the local dev bearer scheme), and an approval requires a genuine multi-approver quorum evaluated by `@act/policy`, not a hand-checked count.
- **Open-source federation** — an external contributor works entirely on their own independently-hosted ledger, never sharing a database with upstream. The maintainer's ledger pulls the contribution over real HTTP and re-verifies it against local trust policy before accepting it.
- **Safety-critical challenge** — separation of duties, formal verification evidence, and a Challenge that's raised but not yet resolved by the time a release-readiness check runs — proving the check reads real, current ledger state rather than an assumed-clean history.

## Shared fixtures

[`examples/shared/fixtures.ts`](https://github.com/JGalego/ACT-protocol/blob/main/examples/shared/fixtures.ts) generalizes the envelope-building helpers proven in `services/api`'s own test suite across every artifact type an example needs (Intent, Requirement, Task, Test, AIProposal, Decision, Evidence, Policy, ApprovalRequest/Decision, Challenge, VerificationReport, Transformation), plus real HTTP server helpers. Every payload shape matches a real schema and, where one exists, the real positive fixture under `schemas/**/fixtures/positive/` — nothing here is hand-derived without a schema-shaped source of truth.
