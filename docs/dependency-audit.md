# Dependency Audit

## Current Status (as of this release)

```
$ pnpm audit
No known vulnerabilities found
```

This was not the starting state. `pnpm audit` initially reported 5 advisories against the transitive `vite` dependency pulled in by `vitest`/`@vitest/coverage-v8` (one critical — an arbitrary file read/execute via Vitest's UI server, which this repository never enables — one high, and three moderate, all `vite` path-traversal/UNC-handling issues). All five were dev-tooling-only: `vite` and `vitest` are `devDependencies` in every workspace package, never included in a package's published `files`, a container image, or any runtime dependency tree, so none of them affected `PROMPT.md`'s bar of "no known critical or high-severity vulnerabilities in shipped runtime dependencies or container images." They were fixed anyway rather than left as an accepted risk:

1. Upgraded `vitest` and `@vitest/coverage-v8` from `^2.1.8` to `^3.2.6` across all eight workspace packages that use them, which resolved the critical Vitest-UI advisory (fixed upstream in `vitest@3.2.6`).
2. Added a `pnpm-workspace.yaml` dependency override (`overrides: { vite: ">=6.4.3" }`) to force the transitive `vite` dependency past the remaining path-traversal/UNC advisories, which resolved to `vite@8.1.4`.
3. Re-ran every package's full test suite after each change (215 tests across `packages/core`, `packages/crypto`, `packages/ledger`, `packages/policy`, `packages/verification`, `packages/sdk-typescript`, `services/api`, and `apps/cli`) to confirm the dependency bump introduced no regressions before accepting it.

## How to Reproduce

```bash
pnpm install
pnpm audit
```

## Runtime Dependency Inventory

Production runtime dependencies (i.e. what actually ships, excluding `devDependencies` used only for building/testing) are, per package:

| Package | Runtime dependencies |
| --- | --- |
| `packages/core` | `ajv`, `uuid` |
| `packages/crypto` | `@act/core` (Node's built-in `node:crypto` provides Ed25519; no external crypto library) |
| `packages/ledger` | `@act/core`, `@act/crypto`, `better-sqlite3` |
| `packages/policy` | `@act/core` |
| `packages/verification` | `@act/core`, `@act/crypto`, `@act/ledger`, `@act/policy` |
| `packages/sdk-typescript` | `@act/core`, `@act/crypto` (uses the global `fetch`; no HTTP client library) |
| `services/api` | the above, plus `fastify`, `fastify-plugin`, `@fastify/cors`, `@fastify/rate-limit`, `@fastify/sensible` |
| `apps/cli` | the above, plus `commander` |

This is a deliberately small runtime surface: no external crypto, canonicalization, or HTTP-client library is a runtime dependency of the security-critical packages (ADR 0002 explains why canonicalization is hand-rolled rather than imported).

## SBOM

An automated SBOM generation step (e.g. `syft` or `cyclonedx-npm` wired into CI) is not yet set up in this release — see `docs/roadmap.md`. This document, kept current by hand and re-verified before each release (`docs/release-checklist.md`), is the interim substitute.

## CI Enforcement

`.github/workflows/ci.yml`'s `audit` job runs `pnpm audit` on every push and pull request and fails the build if any vulnerability is reported at or above the `high` severity threshold, so a newly-disclosed advisory in any dependency is caught automatically rather than relying solely on this document staying current.
