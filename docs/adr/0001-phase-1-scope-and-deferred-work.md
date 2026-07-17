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
