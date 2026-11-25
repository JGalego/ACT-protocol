# Dependency Audit

## Current Status (as of this release)

```
$ pnpm audit
No known vulnerabilities found
```

The initial audit reported five dev-tooling advisories through `vitest`/`@vitest/coverage-v8` and their transitive `vite` dependency: one critical Vitest UI-server file-read/execute issue, one high, and three moderate path-traversal/UNC-handling issues. The UI server was not enabled and the affected tooling was excluded from published packages and runtime images. The fixes were:

1. Upgraded `vitest` and `@vitest/coverage-v8` from `^2.1.8` to `^3.2.6` across the workspace packages that use them, which resolved the critical Vitest-UI advisory (fixed upstream in `vitest@3.2.6`).
2. Added a `pnpm-workspace.yaml` dependency override (`overrides: { vite: "6.4.3" }`) to force the transitive `vite` dependency past the remaining path-traversal/UNC advisories while staying on the major version supported by the Explorer's React plugin.
3. Re-ran every package's full test suite after each change (221 unit/integration tests across `packages/core`, `packages/crypto`, `packages/ledger`, `packages/policy`, `packages/verification`, `packages/sdk-typescript`, `services/api`, `apps/cli`, and `apps/explorer`, plus 6 real-browser Explorer tests) to confirm the dependency changes introduced no regressions before accepting them.

## November 2026 Refresh

New advisories were published against the website's Astro/Starlight tree and several transitive dependencies (`fastify`, `find-my-way`, `fast-uri`, `brace-expansion`, `js-yaml`, `sharp`, `vite`, `tinypool`, and others), and the CI `audit` job began failing. Resolved by:

1. `pnpm update -r`, which moved every workspace dependency to the newest release within its existing semver range (including `fastify` >= 5.12.8, the one affected package that ships at runtime, and `astro` 7.4.x).
2. Raising the `vite` overrides to 6.4.6 (and covering `vite-node>vite`, which the earlier scoped overrides missed), and bumping the Explorer's exact `vite` pin to match.
3. Adding a `vitest>tinypool` override (2.1.2). Every tinypool 1.x carries a critical worker-options prototype-pollution advisory and `vitest@3` pins `^1`. This is dev tooling only.

`pnpm audit --audit-level=high` now passes. What remains is moderate/low and dev-only: vitest 3's own `vitest`/`@vitest/mocker` advisories (fixed only in vitest >= 4.1.11, a major upgrade that would also need the coverage floors re-validated), `glob`/`minimatch` under `@vitest/coverage-v8`, and `katex` under `mermaid`.

`astro` 7.4 requires Node >= 22.23.4; CI's `node-version: '22'` resolves to a compatible release.

## How to Reproduce

```bash
pnpm install
pnpm audit
```

## Runtime Dependency Inventory

Runtime dependencies, excluding build and test tooling:

| Package | Runtime dependencies |
| --- | --- |
| `packages/core` | `ajv`, `uuid` |
| `packages/crypto` | `@act/core` (Node's built-in `node:crypto` provides Ed25519; no external crypto library) |
| `packages/ledger` | `@act/core`, `@act/crypto`, `better-sqlite3`, `pg` (PostgreSQL adapter, ADR 0008) |
| `packages/policy` | `@act/core` |
| `packages/verification` | `@act/core`, `@act/crypto`, `@act/ledger`, `@act/policy` |
| `packages/sdk-typescript` | `@act/core`, `@act/crypto` (uses the global `fetch`; no HTTP client library) |
| `services/api` | the above, plus `fastify`, `fastify-plugin`, `@fastify/cors`, `@fastify/rate-limit`, `@fastify/sensible` |
| `apps/cli` | the above, plus `commander` |
| `apps/explorer` | `react`, `react-dom`, `cytoscape`, `lucide-react`, and self-hosted IBM Plex font packages |

ADR 0002 explains the local canonicalization implementation.

## SBOM

An automated SBOM generation step (e.g. `syft` or `cyclonedx-npm` wired into CI) is not yet set up in this release. See `docs/roadmap.md`. This document, kept current by hand and re-verified before each release (`docs/release-checklist.md`), is the interim substitute.

## CI Enforcement

The `audit` job in `.github/workflows/ci.yml` runs on every push and pull request and fails for advisories at or above `high` severity.
