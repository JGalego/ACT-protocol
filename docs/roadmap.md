# Roadmap

This document is the single consolidated list of what `PROMPT.md` specifies that this release does **not** implement, why, and what implementing it next would require. See `docs/adr/0001-phase-1-scope-and-deferred-work.md` for the reasoning behind scoping this release as a vertical slice rather than a shallow pass over everything. Nothing on this list is claimed as done anywhere else in this repository; if you find a doc or comment that implies otherwise, it is a defect — please file an issue.

## SDKs

- **Go and Rust SDKs**, and a cross-language conformance suite that proves every SDK verifies every other SDK's signatures over real network traffic (not just shared vectors). `packages/sdk-typescript` and `sdks/python` both exist and are checked against the same frozen, generated vectors under `conformance/vectors/` (`conformance/vectors/generate-vectors.ts`, ported from `packages/core`'s canonicalization/digest tests and `packages/crypto`'s DSSE/signature tests) — porting a new SDK against those vector files is the natural starting point, not re-deriving expected values by hand.

## ACT Explorer

- **Built foundation:** `apps/explorer` is a working React/Vite/Cytoscape.js application with an animated ten-stage support workflow, graph playback and scrubbing, record/evidence/envelope inspection, confidence and intent-drift telemetry, responsive desktop/mobile layouts, visual baselines, and a live adapter for the authenticated `/v1/events` endpoint. It is covered by Vitest and Playwright rather than being a static mockup.
- **API support for search/diff now exists, not yet consumed by the UI:** `services/api` gained `GET /v1/events?eventType=&subjectKind=` (real storage-layer filtering, `StorageAdapter.queryEvents`), `GET /v1/challenges` (cursor-paginated, pre-filtered), and `GET /v1/artifacts/{id}/diff?from=&to=` (structural diff, `services/api/src/diff.ts`). `apps/explorer` does not yet have UI for any of these -- wiring them up is the natural starting point for the "repository-wide artifact search" and "version comparison" items below. Filtering `/v1/events` by actor is still unsupported: actor identity lives inside `envelope_json`, not an indexed column: a real implementation needs a schema migration (a queryable `actor_id` column), not an in-memory filter that would silently break cursor pagination.
- **Remaining full Explorer profile:** repository-wide artifact search and version-comparison UI (backend above), approval/challenge mutation workflows, bundle import/export, redaction/partial-history/large-graph operating states, and the remaining dedicated Approval Graph, Responsibility Timeline, Confidence Heatmap, Intent Drift Timeline, Decision Tree, and Evidence Graph views are not yet implemented. The current app demonstrates those concepts within one transformation DAG; it does not claim the `Explorer` conformance profile defined in `spec/conformance.md`.

## Deployment

- Dockerfiles, Docker Compose (API + PostgreSQL + Explorer + telemetry + local OIDC dev provider), and the Helm chart under `deploy/` are not built. `services/api` runs directly via `node`/`pnpm` today (`make dev`, documented in the root README).

## Authentication

- **Organizational admission control for key registration.** `POST /v1/keys`'s proof-of-possession bootstrap (ADR 0006) grants trust to any caller who can sign for a key they generated; it performs no vetting. A production deployment needing gated admission would add an authorization policy in front of this endpoint.

## Example Applications

- The human+AI pairing scenario is implemented as the independently runnable animated support-triage walkthrough in `apps/explorer`: it covers intent → proposal → transformation → approval → implementation → verification → challenge → revision → runtime observation. Five additional examples from `PROMPT.md` (product-team workflow, competing AI proposals, enterprise quorum workflow, open-source federation, and safety-critical workflow with an unresolved challenge) are not yet built as standalone seeded fixtures.

## How to Pick This Up

Each item above names the exact file(s) to start from. None of them require re-deriving the protocol semantics — `spec/ACT-1.0.md`, `spec/semantic-model.md`, `spec/state-machines.md`, and `spec/federation.md` are already normative and complete for all of the above; what's missing is implementation and its tests, not design.
