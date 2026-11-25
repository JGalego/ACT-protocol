---
title: Roadmap
description: Implemented components and remaining work.
---

This is a summary of [the repository roadmap](https://github.com/JGalego/ACT-protocol/blob/main/docs/roadmap.md). [ADR 0001](https://github.com/JGalego/ACT-protocol/blob/main/docs/adr/0001-phase-1-scope-and-deferred-work.md) records the original release scope and later additions; [Design Decisions](/design-decisions/) explains the implementation choices.

## Built

| Area | What exists |
| --- | --- |
| **Storage** | Both a SQLite adapter and a `StorageAdapter`-conforming PostgreSQL adapter (`packages/ledger/src/postgres-adapter.ts`), sharing one behavioral test suite ([ADR 0008](https://github.com/JGalego/ACT-protocol/blob/main/docs/adr/0008-storage-adapter-and-postgres.md)). |
| **Federation** | Signed bundle export/import, peer registration, and HTTP pull/push transport between independent ledgers (`/v1/federation/peers`, `/v1/federation/pull`, `/v1/federation/push`). |
| **SDKs** | TypeScript and [Python](/sdks/) tests check shared canonicalization/digest vectors and verify each other's signatures. |
| **ACT Explorer** | A React/Vite/Cytoscape.js walkthrough, playback/scrubbing, record/evidence/envelope inspection, confidence and drift displays, a Confidence Heatmap, responsive layouts, visual baselines, and an authenticated `/v1/events` adapter. |
| **Formal Methods** | Bounded TLA+/TLC checks of receipt integrity, immutable history, lineage, approval, intent authority, and adversarial models under `formal/`. These check the models, not the implementation. |
| **Deployment** | Non-root, multi-stage Dockerfiles, a Compose stack (API, PostgreSQL, Explorer, OpenTelemetry Collector, and local OIDC provider), and a Helm chart. See [Deployment](/deployment/). |
| **Authentication** | Production OIDC/JWT validation (fail-closed outside local dev mode) alongside the documented local dev bearer scheme, plus Ed25519 proof-of-possession key bootstrap ([ADR 0006](https://github.com/JGalego/ACT-protocol/blob/main/docs/adr/0006-api-authentication-and-trust-bootstrap.md)). |
| **Example Applications** | The Explorer walkthrough and API scenarios described in [Examples](/examples/). |

## Remaining work

- **Go and Rust SDKs**, plus cross-language signature verification over HTTP. Start with `conformance/vectors/` and use `sdks/python` as a porting reference.
- **Repository-wide artifact search and version-comparison UI** in the Explorer. Connect the existing event-filter and artifact-diff endpoints. Actor filtering still needs a queryable `actor_id` column; the identity currently lives in `envelope_json`.
- **Remaining Explorer conformance profile:** approval and challenge mutation workflows, bundle import/export UI, redaction and partial-history and large-graph operating states, plus dedicated Approval Graph, Responsibility Timeline, Intent Drift Timeline, Decision Tree, and Evidence Graph views. The current app demonstrates those concepts within one transformation DAG. It doesn't yet claim the full `Explorer` conformance profile in `spec/conformance.md`.
- **Multi-party key admission.** Basic gating exists: `ACT_KEY_REGISTRATION=admin`, the production default, restricts registration to configured administrators. Multi-party approval and vetting workflows remain unimplemented.
- **A dedicated demo-data seed script.** Migrations run automatically on boot, but there's no `pnpm run seed`-style command yet. The example applications are runnable today only as a Vitest suite driving HTTP calls.
- **A verified full deployment-stack run.** Static checks and an HTTP smoke test against embedded PostgreSQL do not validate container builds or a complete Compose deployment. See [Deployment](/deployment/).
