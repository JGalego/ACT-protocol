# Roadmap

Remaining work from `PROMPT.md`, with implementation status and starting points. [ADR 0001](adr/0001-phase-1-scope-and-deferred-work.md) records the original release scope and later additions.

## SDKs

- **Go and Rust SDKs**, plus cross-language signature verification over HTTP. TypeScript and Python use shared frozen vectors under `conformance/vectors/` and bidirectional signature fixtures under `conformance/interop/`. Start new ports with those vectors, generated from `packages/core` and `packages/crypto`.

## ACT Explorer

- **Built:** a React/Vite/Cytoscape.js walkthrough, playback and scrubbing, record/evidence/envelope inspection, confidence and drift displays, responsive layouts, visual baselines, and an authenticated `/v1/events` adapter. Vitest and Playwright cover the app.
- **Search/diff API available; UI pending:** `GET /v1/events?eventType=&subjectKind=` filters through `StorageAdapter.queryEvents`; `GET /v1/challenges` is cursor-paginated; `GET /v1/artifacts/{id}/diff?from=&to=` uses `services/api/src/diff.ts`. Connect these to the Explorer's search and version-comparison UI. Actor filtering needs a queryable `actor_id` column: filtering `envelope_json` after pagination would produce incomplete pages.
- **Confidence Heatmap (built):** `apps/explorer/src/components/ConfidenceHeatmap.tsx` shows semantic, implementation, and verification confidence for all records independently of timeline position. The Timeline/Confidence switch is covered by Vitest and Playwright.
- **Remaining full Explorer profile:** repository-wide artifact search and version-comparison UI (backend above), approval/challenge mutation workflows, bundle import/export, redaction/partial-history/large-graph operating states, and the remaining dedicated Approval Graph, Responsibility Timeline, Intent Drift Timeline, Decision Tree, and Evidence Graph views are not yet implemented. The current app demonstrates those concepts within one transformation DAG; it does not claim the `Explorer` conformance profile defined in `spec/conformance.md`.

## Deployment

- **Built:** non-root, multi-stage Dockerfiles; a Compose stack with API, PostgreSQL, Explorer, a Prometheus-scraping OpenTelemetry Collector, and the local OIDC provider; and a Helm chart with a read-only root filesystem, dropped capabilities, `NetworkPolicy`, `PodDisruptionBudget`, migration Job, and database Secret references. `make verify-deploy` checks the chart and Dockerfiles; CI's `deploy-lint` job also checks Compose configuration. See `docs/deployment.md`.
- **Full stack run not verified during development:** static checks passed and the HTTP smoke sequence ran against embedded PostgreSQL, but that did not validate container builds or a complete Compose deployment. See `docs/deployment.md` for Docker-dependent checks.
- **Demo-data seed command:** migrations run on boot, but there is no standalone `pnpm run seed`-style command. The API scenarios in `examples/` run as Vitest suites.

## Authentication

- **Organizational admission control for key registration (built, minimal).** `ACT_KEY_REGISTRATION=admin` (the production default) restricts `POST /v1/keys` to the administrators in `ACT_ADMIN_ACTORS` (ADR 0009). Richer admission (multi-party approval of a new key, vetting workflows) is not built.

## Trust and Authority (follow-ups to ADR 0009)

- **Authority roles from signed assignments (built).** Roles for `intent_effective_selected` / `intent_merged` come from `accountability_assigned` events in the tenant's ledger (ADR 0011). Not built: ledger-derived administrators (adding one is still configuration), multi-party approval of a grant, and a role-expiry reminder or notification.
- **Approval validity and quorum as an API.** `@act/verification`'s `checkApprovalValidity` and `@act/policy`'s `evaluateQuorum` are not yet exposed through an endpoint; the write path enforces the lifecycle but a consumer must call the packages to decide whether an approval currently authorizes an action.
- **Drift-assessment schema.** Spec section 7.3 requires a drift result to name its comparison target; there is no dedicated schema enforcing it yet.
- **Tenant isolation (built).** Each tenant is its own ledger in a shared database (ADR 0010). Not built: per-tenant database or KMS-held signing keys for the non-default tenants, per-tenant rate limits and quotas, and tenant-aware metrics.
- **Witnessed checkpoints (built).** Signed checkpoints, witness cosignatures, a witness step (`witnessStep`), and linear consistency and inclusion proofs (ADR 0013). Not built: a standalone witness daemon or CLI command around `witnessStep`, gossip between witnesses, publishing checkpoints to an external transparency log, and Merkle-tree receipts for logarithmic proofs (a receipt-format change).
- **Key validity at signing time on import (built).** Imports judge key standing at the source receipt's `accepted_at` (ADR 0012). Not built: bounding the clock skew between ledgers (a revocation within the skew can fall on either side), and applying the same rule to the CLI's workspace trust, which has no key history.
- **State-machine and privacy conformance vectors.** See `spec/conformance.md` section 2.
