# ADR 0004: Storage Adapter Interface Sized for a Second (Deferred) Backend

## Status

Accepted

## Context

`PROMPT.md` requires "a storage abstraction with behaviorally equivalent SQLite and PostgreSQL adapters." This release implements only the SQLite adapter (ADR 0001), but a same-named-later PostgreSQL adapter should not force a breaking change to `packages/ledger`'s public API or to every caller in `services/api` and `apps/cli`.

## Decision

`packages/ledger`'s `Ledger` class is written against a plain constructor-injected `db` handle and a `TrustPolicy` interface, with every write and read operation expressed as parameterized SQL issued through `better-sqlite3`'s prepared-statement API rather than through SQLite-specific query sugar (no `INSERT OR IGNORE`-style dialect-specific shortcuts beyond `ON CONFLICT DO UPDATE`, which PostgreSQL also supports natively). The `AppendResult`, `StoredEvent`, `LineageResult`, and `TrustPolicy` types in `packages/ledger/src/types.ts` are storage-neutral.

A future `PostgresLedgerAdapter` would implement the same constructor-and-method shape (or a shared `StorageAdapter` interface extracted from the current `Ledger` class) and pass the exact same test suite in `packages/ledger/src/__tests__/`, run twice — once per adapter — to demonstrate behavioral equivalence, per `PROMPT.md`'s "SQLite and PostgreSQL integration tests" requirement.

## Consequences

- No premature abstraction was introduced now (there is exactly one concrete adapter today); the interface boundary exists only where it is already exercised (the constructor and public methods), not as a speculative plugin system.
- The Definition of Done item "SQLite and PostgreSQL exhibit equivalent protocol behavior" is not met by this release and is tracked explicitly in `docs/roadmap.md`, not silently skipped.
