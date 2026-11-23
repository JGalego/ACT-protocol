# Roadmap

This document is the single consolidated list of what `PROMPT.md` specifies that this release does **not** implement, why, and what implementing it next would require. See `docs/adr/0001-phase-1-scope-and-deferred-work.md` for the reasoning behind scoping this release as a vertical slice rather than a shallow pass over everything. Nothing on this list is claimed as done anywhere else in this repository. If you find a doc or comment that implies otherwise, it is a defect. Please file an issue.

## SDKs

- **Go and Rust SDKs**, and a cross-language conformance suite that proves every SDK verifies every other SDK's signatures over real network traffic (not just shared vectors). `packages/sdk-typescript` and `sdks/python` both exist and are checked against the same frozen, generated vectors under `conformance/vectors/` (`conformance/vectors/generate-vectors.ts`, ported from `packages/core`'s canonicalization/digest tests and `packages/crypto`'s DSSE/signature tests). Porting a new SDK against those vector files is the natural starting point, not re-deriving expected values by hand.

## ACT Explorer

- **Built foundation:** `apps/explorer` is a working React/Vite/Cytoscape.js application with an animated ten-stage support workflow, graph playback and scrubbing, record/evidence/envelope inspection, confidence and intent-drift telemetry, responsive desktop/mobile layouts, visual baselines, and a live adapter for the authenticated `/v1/events` endpoint. It is covered by Vitest and Playwright rather than being a static mockup.
- **API support for search/diff now exists, not yet consumed by the UI:** `services/api` gained `GET /v1/events?eventType=&subjectKind=` (real storage-layer filtering, `StorageAdapter.queryEvents`), `GET /v1/challenges` (cursor-paginated, pre-filtered), and `GET /v1/artifacts/{id}/diff?from=&to=` (structural diff, `services/api/src/diff.ts`). `apps/explorer` does not yet have UI for any of these. Wiring them up is the natural starting point for the "repository-wide artifact search" and "version comparison" items below. Filtering `/v1/events` by actor is still unsupported: actor identity lives inside `envelope_json`, not an indexed column: a real implementation needs a schema migration (a queryable `actor_id` column), not an in-memory filter that would silently break cursor pagination.
- **Confidence Heatmap view (built):** a repository-wide, timeline-independent view (`apps/explorer/src/components/ConfidenceHeatmap.tsx`) showing semantic/implementation/verification confidence for every record at once, reachable via a Timeline/Confidence switch in the topbar. Covered by a Vitest interaction test and a real (non-mocked) Playwright e2e test.
- **Remaining full Explorer profile:** repository-wide artifact search and version-comparison UI (backend above), approval/challenge mutation workflows, bundle import/export, redaction/partial-history/large-graph operating states, and the remaining dedicated Approval Graph, Responsibility Timeline, Intent Drift Timeline, Decision Tree, and Evidence Graph views are not yet implemented. The current app demonstrates those concepts within one transformation DAG; it does not claim the `Explorer` conformance profile defined in `spec/conformance.md`.

## Deployment

- **Built:** hardened, non-root, multi-stage Dockerfiles for `services/api` and `apps/explorer` (`deploy/docker/`); a full Docker Compose stack (API + PostgreSQL + Explorer + a real Prometheus-scraping OpenTelemetry Collector + the local OIDC dev provider, `deploy/compose/docker-compose.yml`); and a Helm chart with secure defaults: non-root, read-only root filesystem, dropped capabilities, `NetworkPolicy`, `PodDisruptionBudget`, a pre-install migration Job, and an `existingSecret` pattern for the database connection string (`deploy/helm/act/`). `make verify-deploy` statically validates all of it (`helm lint`/`helm template` + `kubeconform` schema validation + `hadolint`) without needing a Docker daemon or live cluster; CI's `deploy-lint` job additionally validates the Compose files with a real `docker compose ... config`. See `docs/deployment.md`.
- **Not yet run end-to-end:** this repository's own development sandbox has no usable Docker daemon, so the Dockerfiles/Compose stack have been statically validated but not actually built or run here (`make verify-integration`'s real dockerized-Postgres run, and `scripts/integration-smoke.ts`'s HTTP smoke sequence against it, are proven correct against a stand-in embedded-postgres server instead; see `docs/deployment.md`'s Prerequisites section for the exact caveat).
- **Not yet built:** a dedicated demo-data seed script/command. Migrations run automatically on boot; there is no equivalent one-shot command to populate a fresh deployment with realistic data. `examples/`'s six seeded scenarios (below) are runnable against any `services/api` instance today, but only as a Vitest suite driving HTTP calls, not as a standalone `pnpm run seed`-style command.

## Authentication

- **Organizational admission control for key registration (built, minimal).** `ACT_KEY_REGISTRATION=admin` (the production default) restricts `POST /v1/keys` to the administrators in `ACT_ADMIN_ACTORS` (ADR 0009). Richer admission (multi-party approval of a new key, vetting workflows) is not built.

## Trust and Authority (follow-ups to ADR 0009)

- **Authority roles from signed assignments (built).** Roles for `intent_effective_selected` / `intent_merged` come from `accountability_assigned` events in the tenant's ledger (ADR 0011). Not built: ledger-derived administrators (adding one is still configuration), multi-party approval of a grant, and a role-expiry reminder or notification.
- **Approval validity and quorum as an API.** `@act/verification`'s `checkApprovalValidity` and `@act/policy`'s `evaluateQuorum` are not yet exposed through an endpoint; the write path enforces the lifecycle but a consumer must call the packages to decide whether an approval currently authorizes an action.
- **Drift-assessment schema.** Spec section 7.3 requires a drift result to name its comparison target; there is no dedicated schema enforcing it yet.
- **Tenant isolation (built).** Each tenant is its own ledger in a shared database (ADR 0010). Not built: per-tenant database or KMS-held signing keys for the non-default tenants, per-tenant rate limits and quotas, and tenant-aware metrics.
- **Key validity at signing time on import (built).** Imports judge key standing at the source receipt's `accepted_at` (ADR 0012). Not built: bounding the clock skew between ledgers (a revocation within the skew can fall on either side), and applying the same rule to the CLI's workspace trust, which has no key history.
- **State-machine and privacy conformance vectors.** See `spec/conformance.md` section 2.

## How to Pick This Up

Each item above names the exact file(s) to start from. None of them require re-deriving the protocol semantics. `spec/ACT-1.0.md`, `spec/semantic-model.md`, `spec/state-machines.md`, and `spec/federation.md` are already normative and complete for all of the above; what's missing is implementation and its tests, not design.
