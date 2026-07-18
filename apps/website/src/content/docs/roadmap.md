---
title: Roadmap
description: What's built, what's deliberately deferred, and why.
---

ACT was deliberately scoped as a complete, non-fabricated **vertical slice** rather than a shallow pass over everything `PROMPT.md` describes ([ADR 0001](https://github.com/JGalego/ACT-protocol/blob/main/docs/adr/0001-phase-1-scope-and-deferred-work.md)). See [Design Decisions](/design-decisions/) for that reasoning and the ADRs behind it. This page lists what's actually built today and what's still deliberately deferred. If you find a doc or comment that claims something below as done when it isn't, or the other way round, that's a defect. Please [file an issue](https://github.com/JGalego/ACT-protocol/issues).

:::tip[Looking for the authoritative version?]

`docs/roadmap.md` in the repository is the single source of truth this page is kept in sync with. If the two ever disagree, trust the repository.

:::

## Built

| Area | What exists |
| --- | --- |
| **Storage** | Both a SQLite adapter and a `StorageAdapter`-conforming PostgreSQL adapter (`packages/ledger/src/postgres-adapter.ts`), sharing one behavioral test suite ([ADR 0008](https://github.com/JGalego/ACT-protocol/blob/main/docs/adr/0008-storage-adapter-and-postgres.md)). |
| **Federation** | Signed bundle export/import between independent ledgers, peer registration, and a real network pull/push transport (`/v1/federation/peers`, `/v1/federation/pull`, `/v1/federation/push`), not just single-ledger bundle round-tripping. |
| **SDKs** | `packages/sdk-typescript` and [`sdks/python`](/sdks/) both exist and are checked against the same frozen, generated conformance vectors under `conformance/vectors/`, proving byte-identical canonicalization, digests, and cross-language signature verification. |
| **ACT Explorer** | A working React/Vite/Cytoscape.js app: the animated ten-stage support workflow, graph playback/scrubbing, record/evidence/envelope inspection, confidence and intent-drift telemetry, a repository-wide Confidence Heatmap view, responsive layouts, visual baselines, and a live adapter for the authenticated `/v1/events` endpoint. |
| **Formal Methods** | A TLA+ model under `formal/` covering append-only receipt integrity, immutable history, acyclic lineage, approval lifecycle safety, and effective-intent transition safety, checked by TLC in CI. |
| **Deployment** | Hardened, non-root, multi-stage Dockerfiles, a full Docker Compose stack (API, PostgreSQL, Explorer, a real OpenTelemetry Collector, and a local OIDC dev provider), and a Helm chart with secure defaults. See [Deployment](/deployment/). |
| **Authentication** | Production OIDC/JWT validation (fail-closed outside local dev mode) alongside the documented local dev bearer scheme, plus Ed25519 proof-of-possession key bootstrap ([ADR 0006](https://github.com/JGalego/ACT-protocol/blob/main/docs/adr/0006-api-authentication-and-trust-bootstrap.md)). |
| **Example Applications** | All six seeded scenarios described in [Examples](/examples/), each an independently runnable, assertion-backed walkthrough against a real `services/api` instance. |

## Deliberately deferred

- **Go and Rust SDKs**, and a cross-language conformance suite proving every SDK verifies every other SDK's signatures over real network traffic, not just shared vectors. Porting a new SDK against `conformance/vectors/` is the natural starting point; `sdks/python` is the template to follow.
- **Repository-wide artifact search and version-comparison UI** in the Explorer. The API support already exists (`GET /v1/events?eventType=&subjectKind=`, `GET /v1/artifacts/{id}/diff`); wiring it into the UI is what's missing, not backend work. Filtering by actor still needs a schema migration (a queryable `actor_id` column), since actor identity today lives inside `envelope_json`.
- **Remaining Explorer conformance profile:** approval and challenge mutation workflows, bundle import/export UI, redaction and partial-history and large-graph operating states, plus dedicated Approval Graph, Responsibility Timeline, Intent Drift Timeline, Decision Tree, and Evidence Graph views. The current app demonstrates those concepts within one transformation DAG. It doesn't yet claim the full `Explorer` conformance profile in `spec/conformance.md`.
- **Organizational admission control for key registration.** `POST /v1/keys`'s proof-of-possession bootstrap grants trust to any caller who can sign for a key they generated. It performs no vetting beyond that. A production deployment needing gated admission would add an authorization policy in front of this endpoint.
- **A dedicated demo-data seed script.** Migrations run automatically on boot, but there's no `pnpm run seed`-style command yet. The example applications are runnable today only as a Vitest suite driving HTTP calls.
- **An end-to-end run of the deployment stack in this development sandbox**, since there's no usable Docker daemon here. It's statically validated (`make verify-deploy`) and proven for real in CI's `deploy-lint` job instead. See [Deployment](/deployment/)'s caveat.

## How to pick this up

None of the above requires re-deriving the protocol semantics. `spec/ACT-1.0.md`, `spec/semantic-model.md`, `spec/state-machines.md`, and `spec/federation.md` are already normative and complete for all of it. What's missing is implementation and its tests, not design.
