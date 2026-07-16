# Testing Strategy

## Coverage Floors

Per `PROMPT.md`'s Quality Engineering section:

- **Core protocol, cryptographic, policy, and ledger packages**
  (`packages/core`, `packages/crypto`, `packages/ledger`,
  `packages/policy`, `packages/verification`) maintain **≥90% branch
  coverage**, enforced by each package's `vitest.config.ts`
  (`coverage.thresholds`).
- **The remaining first-party implementation**
  (`packages/sdk-typescript`, `services/api`, `apps/cli`) maintains
  **≥80% branch coverage**, same enforcement mechanism.
- Generated code (`packages/core/src/generated/domain.ts`,
  `schemas/artifact/types/*.schema.json` and their fixtures) is excluded
  from coverage accounting — it has no independent logic to cover; its
  correctness is verified by `scripts/validate-schemas.ts` instead.

Run `pnpm --filter <package> exec vitest run --coverage` in any package to
check its own numbers, or `make verify` for the aggregate offline gate.

## Test Categories in This Repository

- **Unit tests** for every pure function (canonicalization, digests,
  cycle detection, policy evaluation, key-lifecycle evaluation): one
  `describe` block per exported function, asserting both the success path
  and every distinct failure/edge branch.
- **Property-adjacent tests** for canonicalization (order-independence,
  known JCS unicode vectors) and the receipt hash chain (tamper-detection
  across digest/signature/chain-link, each asserted independently).
- **Integration tests** for `services/api` (`server.test.ts`) using
  Fastify's `.inject()` against a real in-memory SQLite ledger, driving
  full workflows end-to-end: key registration → actor registration →
  intent → transformation → approval request/decision → challenge →
  verification → policy publication → bundle export/import into a second,
  independent ledger.
- **Subprocess smoke tests** for `apps/cli` (`cli-smoke.test.ts`) that
  spawn the actual built `act` binary via `child_process.execFileSync`
  against a temporary workspace directory, proving the CLI wiring itself
  (not just its underlying action functions) works.
- **Schema fixture tests** (`scripts/validate-schemas.ts`) validate every
  schema's positive fixtures as accepted and negative fixtures as
  rejected, for all 46 schemas under `schemas/`.

## What "No Disabled Tests" Means Here

`make verify` fails on any skipped (`.skip`), focused (`.only`), or
otherwise disabled test, because Vitest's default configuration treats a
lingering `.only` as a build-breaking mistake and this repository does not
override that. There are no `it.skip`/`describe.skip` blocks anywhere in
this repository as of this release.

## Deferred Test Categories

Cross-language SDK conformance, Playwright/Explorer/accessibility tests,
formal-model-checker runs, load/resource-limit smoke tests, and
PostgreSQL-adapter parity tests are not present, because the systems they
would test (Python/Go/Rust SDKs, ACT Explorer, `formal/`, a load-test
harness, a PostgreSQL adapter) are themselves deferred — see
`docs/roadmap.md`. `make verify-integration` documents its Docker
prerequisite and fails with an explicit message when Docker is
unavailable, rather than silently reporting success.
