# ADR 0001: Phase 1 Scope and Deferred Work

## Status

Accepted

## Context

`PROMPT.md` specifies a normative protocol, federated ledger, core packages, HTTP API, SDKs, Explorer visualizations, formal models, Helm deployment, threat-model tests, and examples. It also prohibits placeholder behavior, disabled tests, and fabricated API data. The initial release needed an explicit subset of those requirements.

## Decision

The initial release implements this protocol-to-ledger workflow:

**Built in this release:**

- `spec/` — the full normative ACT 1.0 specification (protocol, semantic model, state machines, federation, conformance profiles)
- `schemas/` — JSON Schema 2020-12 for events, receipts, signed envelopes, artifact types, policies, approvals, challenges, and federation bundles, with positive and negative fixtures
- `packages/core` — RFC 8785 canonicalization, SHA-256 digests, UUIDv7 ids, Ajv-based strict validation, and schema-generated TypeScript types
- `packages/crypto` — Ed25519 keys, DSSE envelope sign/verify, key lifecycle evaluation
- `packages/ledger` — a SQLite-backed, hash-chained, atomic-write-path ledger with cycle detection, duplicate/idempotency handling, bounded lineage traversal, and quarantine
- `packages/policy` — deterministic approval-requirement and authority-selection evaluation, with quorum and separation-of-duties
- `packages/verification` — integrity, lineage, and approval-validity checks, plus structural, provider-neutral OpenAI-compatible, and human assessors, with a local AI-assessor emulator
- `packages/sdk-typescript` — a retrying HTTP client and event builder
- `services/api` — a Fastify service implementing a working subset of the `/v1` contract end-to-end (actor/key bootstrap, intents, transformations, artifacts, approvals, challenges, verifications, policies, lineage, history, events, bundle export/import, quarantine), with an OpenAPI 3.1 document, RFC 9457 errors, and a fail-closed production-mode check
- `apps/cli` — the `act` CLI operating against a local embedded SQLite workspace (init, doctor, actor, key, intent, verify, lineage, history, export, import, projection rebuild, backup, restore)
- CLI tests record and verify events in a local workspace ledger

**Deferred in the original phase decision:**

- PostgreSQL storage adapter (SQLite only; the storage interface is adapter-shaped so a Postgres implementation can be added without an API change)
- Federation transport between independently-hosted ledgers (bundle export/import against a single ledger's own SQLite store is implemented and tested; multi-ledger network transport, and cross-ledger fork/equivocation detection over a network, are not)
- Python, Go, and Rust SDKs, and the cross-language conformance suite that depends on them
- ACT Explorer (the React/Cytoscape web application; an animated lineage demonstration was subsequently implemented, as recorded below)
- The machine-checked formal model (TLA+ or equivalent) under `formal/`
- Docker/Compose/Helm deployment manifests and the local OIDC development provider
- Seeded example applications
- Full OIDC/JWT production authentication (a documented, fail-closed dev bearer scheme stands in; see ADR 0006)

## Consequences

- `conformance/CONFORMANCE_REPORT.md` (once generated) MUST report Core and Cryptographic Integrity profile conformance as passing, and MUST report Federation, SDK, and Explorer profiles as not yet claimed rather than silently passing.
- `make verify` covers everything built; `make verify-integration` documents its Docker/PostgreSQL prerequisite as unmet in this environment rather than claiming a false pass.
- Deferred work is listed here and in `docs/roadmap.md`.

## Amendment: Animated Explorer Demonstration

On 2026-07-17, `apps/explorer` implemented the first operational Explorer slice: a responsive React/Cytoscape application that animates a seeded human-and-AI transformation through intent, proposal, scoped approval, implementation, semantic drift, challenge, revision, and runtime observation. It also adapts real ordered events from `/v1/events` and is covered by Vitest plus desktop/mobile Playwright visual checks.

This amendment removes the animated lineage demonstration from deferred scope. It does not claim the full Explorer conformance profile: the remaining operational workflows and dedicated visualization modes stay listed in `docs/roadmap.md`.

## Amendment: PostgreSQL Adapter and Federation Transport

On 2026-07-18, `packages/ledger` gained a `PostgresAdapter` checked against the SQLite adapter's shared test suite using embedded PostgreSQL (ADR 0008). `services/api` gained peer registration and HTTP bundle pull/push through the existing import path, with fork and equivocation findings. `services/api/src/__tests__/federation.test.ts` checks transport, Key-event trust bootstrap, and both finding classes across two listening API instances.

This amendment removes "PostgreSQL storage adapter" and "Federation transport between independently-hosted ledgers" from deferred scope.

## Amendment: Machine-Checked Formal Model

On 2026-07-18, `formal/` gained TLA+ modules checked by TLC (`make verify-formal`, `scripts/formal/run-tlc.sh`). `LedgerReceiptChain`, `AcyclicLineage`, `ApprovalLifecycle`, and `IntentAuthority` cover the Definition-of-Done invariants; `ChallengeLifecycle`, `KeyLifecycle`, and `ArtifactVersionLifecycle` check types and terminal states. Deliberately broken guards were also checked to confirm that the invariants could fail. See `formal/README.md` for current properties and limits.

This amendment removes "The machine-checked formal model (TLA+ or equivalent) under `formal/`" from deferred scope.

## Amendment: adversarial formal models (ADR 0009)

The initial modules modeled single-record state tables and found none of the defects in the later review. The subsequent adversarial models cover the write path, concurrent/crashing appends, approval authorization, intent authority, and federation, with mutation checks and a stateful API test. See `formal/README.md` for later additions.

## Amendment: Conformance Report

On 2026-07-18, `conformance/` gained a profile-aware runner and frozen vectors generated by calls to `@act/core` and `@act/crypto`. SDKs must reproduce those outputs. `pnpm run conformance:run`, included in `make verify` and CI, writes Markdown and JSON reports: Core, Cryptographic Integrity, and Federation passed; Secure Service and Explorer were not claimed, with blocking reasons. The SDK profile was added after the Python interoperability checks.

This amendment removes "Conformance" (the deferred fixture-driven runner and report) from deferred scope; Secure Service and Explorer profile conformance remain deferred pending their respective implementations.

## Amendment: Python SDK

On 2026-07-18, `sdks/python` (`act-sdk`) ported `packages/core` and `packages/crypto` to Python at the same abstraction level as `packages/sdk-typescript`: RFC 8785 canonicalization (reproducing ECMA-262 `Number::toString`'s exact digit formatting and RFC 8785's UTF-16-code-unit key ordering, neither of which match Python's native `repr`/sort semantics), SHA-256 digests, UUIDv7 ids, Ed25519 keys and DSSE envelope sign/verify (via the `cryptography` package -- the sole third-party runtime dependency, since Ed25519 has no standard-library implementation), key lifecycle evaluation, an unsigned-event builder, and a retrying HTTP client built on `urllib` alone.

`sdks/python/tests/test_vectors.py` loads the same frozen vectors as the TypeScript suite. `test_signatures` compares signature bytes for identical keypairs and messages, using Ed25519's determinism (RFC 8032). `make verify-python-sdk` runs `ruff`, `mypy`, and `pytest` in a separate CI job.

The generators under `conformance/interop/` create committed signature fixtures using fresh keypairs. `conformance/checks/sdk-interop.ts` verifies Python's fixture with `@act/crypto` and invokes `verify-typescript-signed.py` to verify TypeScript's fixture with `act_sdk.crypto`. Both directions run in `make verify`, satisfying the SDK profile's cross-verification requirement. The report now claims the **SDK profile**.

This amendment removes "Python ... SDK" from deferred scope, and removes "SDK" from `conformance/CONFORMANCE_REPORT.md`'s not-yet-claimed profiles (see the Conformance Report amendment above). Go and Rust SDKs remain deferred; when either is added, its own bidirectional interop fixtures against `sdks/python`/`packages/sdk-typescript` are the natural next addition to `conformance/interop/`.

## Amendment: Deployment

On 2026-07-18, `deploy/` gained non-root, multi-stage Dockerfiles; a Compose stack with API, PostgreSQL, Explorer, local OIDC provider, and a Collector scraping `GET /v1/metrics`; and a Helm chart. The chart uses a read-only root filesystem, dropped capabilities, `seccompProfile: RuntimeDefault`, no auto-mounted service account token, `NetworkPolicy`, `PodDisruptionBudget`, and a pre-install/pre-upgrade migration Job. `pnpm deploy` limits the API runtime image to production dependencies.

The readiness probe replaced a constant 200 response with a storage read, so it checks database reachability separately from process liveness.

`make verify-deploy` runs `helm lint`/`helm template`, with `kubeconform` and `hadolint` when available; CI installs both and checks Compose configuration. `make verify-integration` runs the built API over HTTP with PostgreSQL. During development the smoke sequence used embedded PostgreSQL because Docker was unavailable, so container builds and a complete Compose run were not verified. See `docs/deployment.md`.

This amendment removes Docker/Compose/Helm manifests and the local OIDC provider from deferred scope. A standalone demo-data seed command remains deferred.

## Amendment: Explorer Search/Diff Endpoints and a Confidence Heatmap View

On 2026-07-18, `services/api` gained storage-layer event filtering (`GET /v1/events?eventType=&subjectKind=`), a cursor-paginated challenges list, and structural artifact diff (`GET /v1/artifacts/{id}/diff?from=&to=`, `services/api/src/diff.ts`). Actor filtering still needs a queryable column; filtering `envelope_json` after pagination would produce incomplete pages.

The Explorer gained a Confidence Heatmap showing all records' semantic, implementation, and verification confidence independently of timeline position. Vitest and Playwright check the Timeline/Confidence switch.

This amendment does not claim the `Explorer` conformance profile: the new endpoints are not yet consumed by any Explorer UI (search/version-comparison remain UI-less), and the remaining dedicated Approval Graph, Responsibility Timeline, Intent Drift Timeline, Decision Tree, and Evidence Graph views, plus approval/challenge mutation workflows and redaction/large-graph operating states, remain deferred (`docs/roadmap.md`).

## Amendment: Example Applications

On 2026-07-18, `examples/` added API scenarios alongside the Explorer walkthrough: a product-team revision after a failed test, competing AI proposals, enterprise OIDC/quorum with restricted evidence, cross-ledger federation, and a challenge blocking a release-readiness check. Each is a Vitest suite submitting signed envelopes to an in-memory SQLite-backed API. `examples/shared/fixtures.ts` builds payloads from schema and positive-fixture shapes.

The example applications are implemented as tests. A standalone seed command for fresh deployments remains deferred (`docs/roadmap.md`).
