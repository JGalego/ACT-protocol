# Changelog

All notable changes to this project are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/).

Note: this repository distinguishes four version axes that change independently — see [docs/versioning.md](docs/versioning.md):

- **Protocol version** (`protocol_version`, e.g. `act/1.0`)
- **Schema version** (per-schema `$id` version segment)
- **API version** (`/v1`)
- **Implementation version** (this file, the npm/PyPI/crates/Go module versions)

## [Unreleased]

### Security

A project review found that the write path verified signatures and key trust but never tied them together, and that several trust decisions were lost on restart or never made. Fixed (see [ADR 0009](docs/adr/0009-attribution-key-registry-and-federation-trust.md)):

- An event could be attributed to an actor whose key did not sign it, or paired with a different actor's id; the ledger now requires the claimed key to be a signer, bound to the claimed actor, with every co-signer trusted, and at least one signature.
- A key id could be taken over by re-registering it with a different public key, and a rejected registration deleted the victim's key. Key ids are now fingerprints of their public keys, the owner must register the key, and the key registry is rebuilt from the event log.
- Federation import verified nothing about the bundle. It now requires a registered peer with a pinned identity, and verifies the bundle id, signature, and every source receipt; missing parents are accepted only where declared; export computes completeness and its gaps.
- Ledger id, signing key, key registry and peers were regenerated or in memory on every start (and per replica). They are now durable and shared.
- Approval and key lifecycles are enforced at write time; selecting or merging an effective intent requires an authority policy; artifact current state is computed from lineage so competing revisions stay visible; a second genesis by a different actor on an existing artifact is refused; `version_id` is recomputed and artifact signatures verified.
- Peer administration, bundle import and the quarantine list are administrator-only; peer URLs are SSRF-checked; peer bearer tokens are never returned.
- `act key trust` / `act import` (CLI): fingerprint-checked keys with owners, no silent key replacement, verified bundles.

### Fixed

- Key validity: a signature dated before the key existed, or evaluated against an unparseable timestamp, was reported valid (TypeScript and Python SDKs).
- Concurrent appends on SQLite failed with nested-transaction errors; concurrent duplicate submissions leaked raw constraint errors; Postgres retried every unique violation as a sequence race; migrations did not run inside their transaction and could race across replicas.
- A missing-parent boundary was never cleared when the parent arrived later; the cycle check loaded every edge in the ledger on each append.
- `findEquivocations` threw on one malformed decision event; `limit`/`cursor`/`maxDepth` parameters returned 500 or bypassed the page cap; an unknown `artifact_type` returned 500 and a missing one skipped validation; the API ignored the `Idempotency-Key` header both SDKs send; a duplicate parent surfaced a raw database error.
- OIDC discovery dropped the issuer's path and cached a failed discovery forever.
- Explorer showed every `approval_decided` as approved and mis-mapped PascalCase artifact types.
- The structural assessor scored a negation flip ("must not log PII" vs "must log PII") as 93% likely-equivalent.
- Spec and docs: receipts are not DSSE-wrapped (spec section 4.2 now says so), forward-compatibility wording matches the closed schemas, and dead file references were removed.

### Changed

- **Breaking (API):** federation peers must be registered with `ledgerId`, `ledgerKeyId`, `ledgerPublicKey`; `GET /v1/federation/peers` no longer returns `bearerToken`; peer, import and quarantine endpoints require an administrator; production requires `ACT_ADMIN_ACTORS`; `GET /v1/artifacts/{id}` returns `currentVersionId: null` with `conflict: true` while branches are unresolved.
- Helm values `api.adminActors` (required), `api.keyRegistration`, `api.ledgerSigningKey`.

### Added

- `GET /v1/ledger`, `key_rotated` / `key_revoked` / `key_compromised` handling, `ACT_ADMIN_ACTORS`, `ACT_KEY_REGISTRATION`, `ACT_LEDGER_PRIVATE_KEY`, `ACT_ALLOW_PRIVATE_PEERS`, `ACT_AUTHORITY_POLICY_FILE`.

- `apps/explorer`: an animated React/Cytoscape demonstration of intent, AI proposal, transformation, approval, implementation, verification, challenge, revision, and runtime observation, with deterministic replay and optional live `/v1/events` loading.
- Responsive Playwright browser coverage and visual baselines for the Explorer at desktop and mobile viewports.

## [1.0.0-rc.1] - 2026-07-16

### Added

- Initial public architecture: monorepo layout, ADRs, and the ACT 1.0 normative specification skeleton (`spec/`).
- Authoritative JSON Schema 2020-12 definitions for the unsigned event payload, DSSE-compatible signed envelope, ledger receipt, and the core artifact types, with positive and negative fixtures.
- `packages/core`: RFC 8785 JSON canonicalization, SHA-256 content/event digests, UUIDv7 identity generation, and Ajv-based strict schema validation.
- `packages/crypto`: Ed25519 key generation, signing, and verification, DSSE envelope construction/parsing, and a key-status model (active, rotated, expired, revoked, compromised).
- `packages/ledger`: SQLite-backed content-addressed ledger with an atomic write path, hash-chained receipts, causal-parent and cycle validation, duplicate/idempotency handling, and rebuildable projections.
- `packages/policy`: versioned policy documents and a deterministic evaluation engine for approval requirements and quorum rules.
- `packages/verification`: a verification toolkit covering schema, cryptographic/ledger-integrity, and lineage checks, with explained, attributable findings.
- `packages/sdk-typescript`: an ergonomic client built on `core` and `crypto` for constructing, signing, and submitting events.
- `services/api`: a Fastify HTTP service implementing a first slice of the `/v1` OpenAPI 3.1 contract against the embedded SQLite ledger.
- `apps/cli`: the `act` command-line tool (`init`, `actor`, `key`, `intent`, `transform`, `verify`, `lineage`, `history`, `export`, `import`) with human-readable and JSON output modes.
- `make verify`: formatting, linting, strict type checking, and the full first-party test suite, runnable offline from a clean checkout.

### Known limitations in this release candidate

See [docs/roadmap.md](docs/roadmap.md) for the complete, explicit list of deferred scope (PostgreSQL adapter, federation import/export, Python/Go/Rust SDKs, the remaining full ACT Explorer profile beyond the implemented animated demonstration, formal-model checking, Helm/production deployment, and five additional example applications). Nothing on that list is claimed as done in this release.
