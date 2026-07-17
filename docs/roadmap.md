# Roadmap

This document is the single consolidated list of what `PROMPT.md` specifies that this release does **not** implement, why, and what implementing it next would require. See `docs/adr/0001-phase-1-scope-and-deferred-work.md` for the reasoning behind scoping this release as a vertical slice rather than a shallow pass over everything. Nothing on this list is claimed as done anywhere else in this repository; if you find a doc or comment that implies otherwise, it is a defect — please file an issue.

## Storage

- **PostgreSQL adapter.** `packages/ledger`'s `Ledger` class is written storage-neutrally (ADR 0004) but only a SQLite adapter (`sqlite-store.ts`) exists. Next step: extract a `StorageAdapter` interface from `Ledger`'s current direct `better-sqlite3` usage, add a `pg`-backed implementation, and run `packages/ledger`'s full test suite against both.

## Federation

- **Multi-ledger network transport.** `POST /v1/bundles/export` and `/import` work against a single ledger's own store (proven by `services/api`'s and `apps/cli`'s test suites). Actually moving a bundle between two independently-hosted ledger deployments over a network, and the associated peer-discovery/authentication story, is not built.
- **Cross-ledger fork/equivocation detection over a network** (as opposed to `packages/ledger/src/cycle.ts`'s in-process cycle detection, which is implemented and tested) requires the network transport above first.

## SDKs

- **Python, Go, and Rust SDKs** and the cross-language conformance suite (`conformance/`) that proves all four SDKs compute identical canonical bytes and event ids and verify each other's signatures. Only `packages/sdk-typescript` exists. The vectors each SDK must reproduce are exactly `packages/core`'s canonicalization/digest tests plus `packages/crypto`'s DSSE/signature tests — porting those test fixtures is the natural starting point.

## ACT Explorer

- **Built foundation:** `apps/explorer` is a working React/Vite/Cytoscape.js application with an animated ten-stage support workflow, graph playback and scrubbing, record/evidence/envelope inspection, confidence and intent-drift telemetry, responsive desktop/mobile layouts, visual baselines, and a live adapter for the authenticated `/v1/events` endpoint. It is covered by Vitest and Playwright rather than being a static mockup.
- **Remaining full Explorer profile:** repository-wide artifact search, version comparison, approval/challenge mutation workflows, bundle import/export, redaction/partial-history/large-graph operating states, and the remaining dedicated Approval Graph, Responsibility Timeline, Confidence Heatmap, Intent Drift Timeline, Decision Tree, and Evidence Graph views are not yet implemented. The current app demonstrates those concepts within one transformation DAG; it does not claim the `Explorer` conformance profile defined in `spec/conformance.md`.

## Formal Methods

- **Machine-checked formal model** (`formal/`) covering append-only receipt integrity, immutable history, acyclic lineage, approval lifecycle safety, and effective-intent transition safety. The properties themselves are implemented and unit-tested in `packages/ledger` (cycle rejection, receipt chaining) and `packages/policy`/`packages/verification` (approval/authority evaluation); what's missing is an independent TLA+ (or Alloy) model of the same invariants, checked by a model checker in CI, per `spec/state-machines.md`.

## Deployment

- Dockerfiles, Docker Compose (API + PostgreSQL + Explorer + telemetry + local OIDC dev provider), and the Helm chart under `deploy/` are not built. `services/api` runs directly via `node`/`pnpm` today (`make dev`, documented in the root README).

## Authentication

- **Production OIDC/JWT validation.** `services/api`'s auth plugin implements only the documented local development bearer scheme (ADR 0006); it fails closed (refuses to start) in `NODE_ENV=production` without it. A real OIDC integration needs a JWKS-fetching JWT verifier and a local dev IdP emulator (e.g. a minimal OIDC provider container) so the flow is testable without a paid identity provider.
- **Organizational admission control for key registration.** `POST /v1/keys`'s proof-of-possession bootstrap (ADR 0006) grants trust to any caller who can sign for a key they generated; it performs no vetting. A production deployment needing gated admission would add an authorization policy in front of this endpoint.

## Example Applications

- The human+AI pairing scenario is implemented as the independently runnable animated support-triage walkthrough in `apps/explorer`: it covers intent → proposal → transformation → approval → implementation → verification → challenge → revision → runtime observation. Five additional examples from `PROMPT.md` (product-team workflow, competing AI proposals, enterprise quorum workflow, open-source federation, and safety-critical workflow with an unresolved challenge) are not yet built as standalone seeded fixtures.

## Conformance

- `conformance/CONFORMANCE_REPORT.md` and the fixture-driven runner (`conformance/run-conformance.ts`) described in `spec/conformance.md` are not yet generated; the fixture categories that exist today live under `schemas/**/fixtures/` and are checked by `scripts/validate-schemas.ts` (`make verify`'s `schemas:validate` step), which is a subset of what the full conformance runner would cover (it does not yet check state-machine transition fixtures, graph/cycle fixtures, or federation fixtures as a separate certified report).

## How to Pick This Up

Each item above names the exact file(s) to start from. None of them require re-deriving the protocol semantics — `spec/ACT-1.0.md`, `spec/semantic-model.md`, `spec/state-machines.md`, and `spec/federation.md` are already normative and complete for all of the above; what's missing is implementation and its tests, not design.
