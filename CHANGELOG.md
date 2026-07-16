# Changelog

All notable changes to this project are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/).

Note: this repository distinguishes four version axes that change independently — see [docs/versioning.md](docs/versioning.md):

- **Protocol version** (`protocol_version`, e.g. `act/1.0`)
- **Schema version** (per-schema `$id` version segment)
- **API version** (`/v1`)
- **Implementation version** (this file, the npm/PyPI/crates/Go module versions)

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

See [docs/roadmap.md](docs/roadmap.md) for the complete, explicit list of deferred scope (PostgreSQL adapter, federation import/export, Python/Go/Rust SDKs, ACT Explorer, formal-model checking, Helm/production deployment, and the six example applications). Nothing on that list is claimed as done in this release.
