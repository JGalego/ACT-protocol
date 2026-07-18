# ADR 0008: StorageAdapter Interface and the PostgreSQL Adapter

## Status

Accepted

## Context

ADR 0004 sized `packages/ledger`'s `Ledger` class to make a future PostgreSQL adapter possible without an API break, but deferred actually building it: `Ledger` called `better-sqlite3` directly at every write-path step. PROMPT.md requires "a storage abstraction with behaviorally equivalent SQLite and PostgreSQL adapters," idempotency keys, optimistic concurrency for head-dependent writes, migration tooling, and projection-rebuild/backup/restore/corruption-check operations. This environment has no Docker daemon and no system PostgreSQL install, so any adapter had to be provable without either.

## Decision

`packages/ledger/src/storage-adapter.ts` defines a `StorageAdapter` interface extracted 1:1 from `Ledger`'s previous `better-sqlite3` call sites (`getEvent`, `getHead`, `listEvents`, `getCausalParentsFor`/`getChildrenOf`/`getAllCausalParents`, `insertQuarantine`/`listQuarantine`, `clearProjections`, plus a `withTransaction` entry point for the atomic write path). Every method returns a `Promise`, so one contract covers both a synchronous driver (`better-sqlite3`) and an inherently asynchronous one (`pg`) without special-casing either inside `Ledger`; `Ledger`'s entire public API is now `async`.

`SqliteAdapter` wraps `better-sqlite3` with no behavior change — its `withTransaction` drives `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` explicitly on the connection (not `better-sqlite3`'s own `db.transaction(cb)` helper, which requires `cb` to be synchronous and therefore cannot host an `async fn`).

`PostgresAdapter` uses `pg` (node-postgres) — chosen because `embedded-postgres` (used for integration tests below) already depends on it, and its plain parameterized-query style (`$1, $2, ...`) matches this repo's existing `prepare/run` convention rather than introducing a tagged-template query-builder DSL. Optimistic concurrency for head-dependent commands runs the append transaction at `REPEATABLE READ` and relies on the pre-existing `UNIQUE(ledger_id, sequence)` constraint plus Postgres's serialization-failure detection (`40001`/`23505`) as the conflict signal, retrying up to 8 attempts with randomized backoff (`jitterBackoffMs`) before surfacing `StorageConflictError`; a real 8-way-concurrent test (`ledger.postgres.test.ts`'s "PostgresAdapter concurrency" suite) forces genuine `23505` conflicts and proves the retry loop resolves them. `SqliteAdapter.withTransaction` runs its callback once, since better-sqlite3's synchronous, single-connection transactions make the race structurally impossible there.

Idempotency keys (declared but unenforced in `AppendOptions` since inception) are now enforced via a new `idempotency_key` column (`UNIQUE(ledger_id, idempotency_key)`).

Migration tooling is hand-rolled (`migrations.ts`'s `runMigrations`, a `schema_migrations` tracking table, one transaction per migration) rather than a third-party migration library, consistent with ADR 0002's rationale for keeping core-package dependencies small and auditable. SQLite and PostgreSQL share the same DDL text (`SQLITE_INIT_SQL`/`POSTGRES_INIT_SQL`): both engines accept `TEXT` primary keys and `ON CONFLICT ... DO UPDATE` natively, so no per-dialect branching is needed for this schema.

Behavioral equivalence is proven by parametrizing one shared assertion suite (`__tests__/shared/ledger-suite.ts`'s `registerLedgerSuite`) over both adapters: `ledger.sqlite.test.ts` (in-memory, instant) and `ledger.postgres.test.ts`, backed by a **real** PostgreSQL server started via the `embedded-postgres` npm package — a statically-linked `postgres` binary downloaded once and run as the current user against a throwaway data directory, no Docker or root required. Each test gets its own Postgres schema (`CREATE SCHEMA test_<n>`, selected via the `search_path` connection option) within one shared cluster, so tests stay isolated without paying a fresh-cluster-per-test cost. Starting the cluster costs about a second; the whole Postgres suite runs in under 10 seconds, cheap enough that it runs in the *default* `pnpm test`/`test:coverage` — not gated behind an opt-in script — so `postgres-adapter.ts` is exercised, and SQLite/PostgreSQL equivalence is proven, on every run.

Backup, restore, and corruption checks are adapter-agnostic rather than filesystem-level: `apps/cli`'s existing `actionBackup`/`actionRestore` (`copyFileSync` on the SQLite file) stay as-is, since the CLI is explicitly scoped to a local SQLite workspace (ADR 0007); a `services/api`-facing snapshot/integrity mechanism for a PostgreSQL deployment is tracked as follow-up work in `docs/roadmap.md` rather than built speculatively here.

## Consequences

- `Ledger`'s public API is a breaking change (every method now returns a `Promise`). `services/api`'s route handlers (already `async`) and `apps/cli`'s action functions and CLI entry point needed `await` added at each call site — mechanical, not a redesign, and covered by the existing test suites plus the CLI's subprocess smoke test.
- `services/api` selects its storage engine via `ACT_STORAGE=sqlite|postgres` and `ACT_DATABASE_URL` (`ledger-context.ts`'s `createLedgerContext`), defaulting to SQLite so existing deployments are unaffected.
- `docs/roadmap.md`'s "PostgreSQL adapter" deferred-work item is resolved by this ADR.
- The `pg` driver and `embedded-postgres` (dev-only) are new dependencies of `packages/ledger`.
