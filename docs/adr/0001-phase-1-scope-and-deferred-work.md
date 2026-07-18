# ADR 0001: Phase 1 Scope and Deferred Work

## Status

Accepted

## Context

`PROMPT.md` specifies a protocol and reference implementation of a scale that genuinely spans a multi-month, multi-team effort: a normative specification, a federated ledger, five core packages, an HTTP API, SDKs in four languages with cross-language conformance, a production React Explorer with nine visualizations, machine-checked formal models, Helm/ production deployment, a full threat-model test suite, and six seeded example applications.

Building all of it, to the letter, in a single working session while honoring the same document's explicit prohibition on "unfinished-work markers, empty packages, placeholder handlers, illustrative-only core logic, disabled tests, or APIs that return fabricated data" is not achievable without violating that prohibition somewhere. Faking breadth (stub SDKs, a marketing-page Explorer, an untested formal model) would satisfy the letter of "every file exists" while failing the actual intent of the specification far worse than an honestly scoped subset would.

## Decision

This release implements a complete, non-fabricated **vertical slice**:

**Built in this release:**

- `spec/` — the full normative ACT 1.0 specification (protocol, semantic model, state machines, federation, conformance profiles)
- `schemas/` — JSON Schema 2020-12 for the event envelope, ledger receipt, DSSE signed envelope, the shared artifact envelope, all 28 artifact types, policies, approvals, challenges, and the federation bundle — with positive and negative fixtures, all passing
- `packages/core` — RFC 8785 canonicalization, SHA-256 digests, UUIDv7 ids, Ajv-based strict validation, and schema-generated TypeScript types
- `packages/crypto` — Ed25519 keys, DSSE envelope sign/verify, key lifecycle evaluation
- `packages/ledger` — a SQLite-backed, hash-chained, atomic-write-path ledger with cycle detection, duplicate/idempotency handling, bounded lineage traversal, and quarantine
- `packages/policy` — deterministic approval-requirement and authority-selection evaluation, with quorum and separation-of-duties
- `packages/verification` — integrity, lineage, and approval-validity checks, plus all three required semantic assessors (deterministic structural, provider-neutral OpenAI-compatible with a deterministic local emulator, and a human-assessment recorder)
- `packages/sdk-typescript` — an ergonomic, retrying HTTP client and event builder
- `services/api` — a Fastify service implementing a working subset of the `/v1` contract end-to-end (actor/key bootstrap, intents, transformations, artifacts, approvals, challenges, verifications, policies, lineage, history, events, bundle export/import, quarantine), with an OpenAPI 3.1 document, RFC 9457 errors, and a fail-closed production-mode check
- `apps/cli` — the `act` CLI operating against a local embedded SQLite workspace (init, doctor, actor, key, intent, verify, lineage, history, export, import, projection rebuild, backup, restore)
- A dogfooding pass: this repository's own build is exercised end-to-end by the test suites above (e.g. the CLI's own workspace ledger records and verifies real events)

**Explicitly deferred in the original phase decision, not fabricated:**

- PostgreSQL storage adapter (SQLite only; the storage interface is adapter-shaped so a Postgres implementation can be added without an API change)
- Federation transport between independently-hosted ledgers (bundle export/import against a single ledger's own SQLite store is implemented and tested; multi-ledger network transport, and cross-ledger fork/equivocation detection over a network, are not)
- Python, Go, and Rust SDKs, and the cross-language conformance suite that depends on them
- ACT Explorer (the React/Cytoscape web application; an animated lineage demonstration was subsequently implemented, as recorded below)
- The machine-checked formal model (TLA+ or equivalent) under `formal/`
- Docker/Compose/Helm deployment manifests and the local OIDC development provider
- The six seeded example applications
- Full OIDC/JWT production authentication (a documented, fail-closed dev bearer scheme stands in; see ADR 0006)

## Consequences

- `conformance/CONFORMANCE_REPORT.md` (once generated) MUST report Core and Cryptographic Integrity profile conformance as passing, and MUST report Federation, SDK, and Explorer profiles as not yet claimed rather than silently passing.
- `make verify` covers everything built; `make verify-integration` documents its Docker/PostgreSQL prerequisite as unmet in this environment rather than claiming a false pass.
- Any contributor picking up deferred work has an explicit, itemized starting list here and in `docs/roadmap.md`, instead of having to reverse-engineer what's missing from silence.

## Amendment: Animated Explorer Demonstration

On 2026-07-17, `apps/explorer` implemented the first operational Explorer slice: a responsive React/Cytoscape application that animates a seeded human-and-AI transformation through intent, proposal, scoped approval, implementation, semantic drift, challenge, revision, and runtime observation. It also adapts real ordered events from `/v1/events` and is covered by Vitest plus desktop/mobile Playwright visual checks.

This amendment removes the animated lineage demonstration from deferred scope. It does not claim the full Explorer conformance profile: the remaining operational workflows and dedicated visualization modes stay listed in `docs/roadmap.md`.

## Amendment: PostgreSQL Adapter and Real Federation Transport

On 2026-07-18, `packages/ledger` gained a `PostgresAdapter` behaviorally equivalent to the SQLite adapter (ADR 0008), proven by running the same assertion suite against both, including a real embedded PostgreSQL server. `services/api` gained real peer-to-peer federation transport (`routes/federation.ts`): registering a peer ledger, pulling its exported bundle through the same import path as direct bundle import, and pushing this ledger's export to a peer, plus fork (informational) and equivocation (adversarial) detection over the pulled result (`@act/ledger`'s `findForks`/`findEquivocations`). A real two-independently-listening-server integration test (`services/api/src/__tests__/federation.test.ts`) proves the transport, trust-bootstrap-from-Key-event, and both finding classes end-to-end.

This amendment removes "PostgreSQL storage adapter" and "Federation transport between independently-hosted ledgers" from deferred scope.

## Amendment: Machine-Checked Formal Model

On 2026-07-18, `formal/` gained seven TLA+ modules matching `spec/state-machines.md`'s six state machines 1:1, checked by a real TLC run (`make verify-formal`, `scripts/formal/run-tlc.sh`) rather than written-but-unexecuted TLA+ source: `LedgerReceiptChain` (`ReceiptChainIntegrity`, `ImmutableHistory`), `AcyclicLineage`, `ApprovalLifecycle` (`TerminalStable`, `OnlyApprovedAuthorizes`), and `IntentAuthority` (`EffectiveIntentSafety`) cover the five Definition-of-Done invariants; `ChallengeLifecycle`, `KeyLifecycle`, and `ArtifactVersionLifecycle` are checked at `TypeOK`-plus-terminal-state-sanity depth. Every invariant was also checked against a deliberately broken variant of its guard to confirm TLC genuinely catches the injected bug rather than passing vacuously (see `formal/README.md`).

This amendment removes "The machine-checked formal model (TLA+ or equivalent) under `formal/`" from deferred scope.

## Amendment: Conformance Report

On 2026-07-18, `conformance/` gained a profile-aware conformance runner (`conformance/run-conformance.ts`) and a frozen set of generated vectors (`conformance/vectors/`, produced by `conformance/vectors/generate-vectors.ts` calling `@act/core`/`@act/crypto` directly — never hand-derived) that the TypeScript implementation is checked against and that a future non-TypeScript SDK must reproduce byte-for-byte. Running `pnpm run conformance:run` (wired into `make verify` and CI) writes `conformance/CONFORMANCE_REPORT.md` and `.json` per `spec/conformance.md` §1: Core, Cryptographic Integrity, and Federation profiles are checked and currently pass in full; Secure Service and Explorer profiles are reported as honestly not-yet-claimed, each with its blocking reason, rather than silently omitted or falsely passed. (The SDK profile joined the claimed set once `sdks/python` and its interop checks existed — see the Python SDK amendment below.)

This amendment removes "Conformance" (the deferred fixture-driven runner and report) from deferred scope; Secure Service and Explorer profile conformance remain deferred pending their respective implementations.

## Amendment: Python SDK

On 2026-07-18, `sdks/python` (`act-sdk`) ported `packages/core` and `packages/crypto` to Python at the same abstraction level as `packages/sdk-typescript`: RFC 8785 canonicalization (reproducing ECMA-262 `Number::toString`'s exact digit formatting and RFC 8785's UTF-16-code-unit key ordering, neither of which match Python's native `repr`/sort semantics), SHA-256 digests, UUIDv7 ids, Ed25519 keys and DSSE envelope sign/verify (via the `cryptography` package -- the sole third-party runtime dependency, since Ed25519 has no standard-library implementation), key lifecycle evaluation, an unsigned-event builder, and a retrying HTTP client built on `urllib` alone.

Its test suite (`sdks/python/tests/test_vectors.py`) loads the exact same frozen, generated files under `conformance/vectors/` that `conformance/vectors/vectors.test.ts` checks the TypeScript implementation against; because Ed25519 signatures are deterministic (RFC 8032), `test_signatures` confirms `sdks/python` produces byte-identical signatures to `packages/crypto` for the same keypair and message, not merely "a plausible-looking implementation." `make verify-python-sdk` (lint via `ruff`, typecheck via `mypy`, test via `pytest`) runs as its own CI job, parallel to `verify-formal`, since it needs its own toolchain rather than the pnpm workspace's.

`conformance/interop/` then closed the loop the SDK profile actually requires (spec/conformance.md §1: "verification of signatures produced by any other conformant SDK", not merely identical vectors): `generate-python-signed.py` and `generate-typescript-signed.ts` each sign real data with a freshly generated keypair and check the result into git; `conformance/checks/sdk-interop.ts` then verifies the Python-signed fixture with `@act/crypto` in-process, and shells out to a real `python3` process (`verify-typescript-signed.py`) to verify the TypeScript-signed fixture with `act_sdk.crypto` -- both directions genuinely executed on every `make verify` run, not asserted from prose. `conformance/CONFORMANCE_REPORT.md` now reports the **SDK profile as CLAIMED**.

This amendment removes "Python ... SDK" from deferred scope, and removes "SDK" from `conformance/CONFORMANCE_REPORT.md`'s not-yet-claimed profiles (see the Conformance Report amendment above). Go and Rust SDKs remain deferred; when either is added, its own bidirectional interop fixtures against `sdks/python`/`packages/sdk-typescript` are the natural next addition to `conformance/interop/`.

## Amendment: Deployment

On 2026-07-18, `deploy/` gained hardened, non-root, multi-stage Dockerfiles for `services/api` and `apps/explorer` (`pnpm deploy` prunes the API image to production dependencies only -- no other workspace package's source, no devDependencies, no monorepo tooling); a full Docker Compose stack (API, PostgreSQL, Explorer, the local OIDC dev provider, and an OpenTelemetry Collector that genuinely scrapes the API's new `GET /v1/metrics` endpoint rather than sitting idle); and a Helm chart (`deploy/helm/act/`) with secure defaults -- non-root, read-only root filesystem, dropped Linux capabilities, `seccompProfile: RuntimeDefault`, no auto-mounted service account token, a `NetworkPolicy` and `PodDisruptionBudget` per component, and a pre-install/pre-upgrade migration Job (`services/api/src/bin/migrate.ts`) so no API replica depends on being the one that happens to migrate first.

`services/api`'s readiness probe (`GET /v1/health/ready`) now performs a real read against the configured storage backend instead of a hardcoded 200, so a Kubernetes readinessProbe or Compose healthcheck genuinely reflects reachability, not just process liveness.

`make verify-deploy` proves the chart renders to schema-valid Kubernetes manifests (`helm lint` + `helm template`, checked against the real Kubernetes OpenAPI schemas via `kubeconform`) and lints both Dockerfiles (`hadolint`) without needing a Docker daemon or a live cluster; neither tool is required locally (both gracefully skip if absent), but CI's `deploy-lint` job always installs them, plus runs a real `docker compose ... config` against both Compose files. `make verify-integration` and `scripts/integration-smoke.ts` prove the actual deployed code path -- the real built `services/api/dist/server.js`, driven over HTTP through a full key-registration → event-listing sequence against `ACT_STORAGE=postgres` -- though only `deploy/compose/docker-compose.test.yml`'s dockerized Postgres is the intended target; this repository's own development sandbox lacks a usable Docker daemon, so that exact path was instead proven correct here against a stand-in embedded-postgres server (see `docs/deployment.md`).

## Amendment: Explorer Search/Diff Endpoints and a Confidence Heatmap View

On 2026-07-18, `services/api` gained three new read endpoints toward the ACT Explorer's remaining operational profile: `GET /v1/events?eventType=&subjectKind=` (a new `StorageAdapter.queryEvents` method -- real indexed-column `WHERE`-clause filtering in both `SqliteAdapter` and `PostgresAdapter`, not an in-memory scan), `GET /v1/challenges` (cursor-paginated, built on the same method), and `GET /v1/artifacts/{id}/diff?from=&to=` (a dependency-free structural diff, `services/api/src/diff.ts`). Filtering `/v1/events` by actor remains unsupported: actor identity lives inside `envelope_json`, not a queryable column, and is documented as such rather than faked with a filter that would silently break cursor pagination.

`apps/explorer` gained its first dedicated visualization beyond the animated timeline: a Confidence Heatmap (`apps/explorer/src/components/ConfidenceHeatmap.tsx`), a repository-wide, timeline-independent view of every record's semantic/implementation/verification confidence, reachable via a Timeline/Confidence switch. Covered by a Vitest interaction test and a real (non-mocked) Playwright e2e test.

This amendment does not claim the `Explorer` conformance profile: the new endpoints are not yet consumed by any Explorer UI (search/version-comparison remain UI-less), and the remaining dedicated Approval Graph, Responsibility Timeline, Intent Drift Timeline, Decision Tree, and Evidence Graph views, plus approval/challenge mutation workflows and redaction/large-graph operating states, remain deferred (`docs/roadmap.md`).

## Amendment: Example Applications

On 2026-07-18, `examples/` gained the five example applications `PROMPT.md`'s Example Applications section still called for beyond the animated human+AI walkthrough already in `apps/explorer`: a product-team workflow (intent → requirements → implementation → a real revision after a failed test → approval), competing AI proposals with a reviewed merge, an enterprise workflow authenticating through the real production OIDC/JWT path (not the local dev bearer scheme) with quorum approval and restricted evidence, open-source federation pulling a signed contribution from an independently-hosted ledger, and a safety-critical workflow whose release-readiness check reads real (immutable, append-only) ledger state to stay blocked while a challenge is open. Every scenario is a Vitest suite driving real signed envelopes against a real (in-memory) `services/api` instance -- not mocked -- under a new `examples/` workspace package, with a shared fixture-building module (`examples/shared/fixtures.ts`) whose payload shapes match real schemas and, where one exists, the real positive fixture under `schemas/**/fixtures/positive/`.

This amendment removes "the six seeded example applications" from deferred scope. What remains deferred, per `docs/roadmap.md`, is a standalone one-shot seed _command_ (`pnpm run seed`-style) for populating a fresh deployment; the six scenarios are runnable today, but only as an assertion suite, not as a CLI convenience.

This amendment removes "Docker/Compose/Helm deployment manifests and the local OIDC development provider" from deferred scope. A dedicated demo-data seed script remains deferred, tracked alongside the seeded example applications below.
