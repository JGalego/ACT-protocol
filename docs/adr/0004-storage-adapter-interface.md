# ADR 0004: Storage Adapter Interface Sized for a Second (Deferred) Backend

## Status

Accepted. Amended by ADR 0010: every adapter method now names the ledger it acts on.

## Context

`PROMPT.md` requires behaviorally equivalent SQLite and PostgreSQL adapters. The initial release implements SQLite only (ADR 0001). Adding PostgreSQL should preserve the storage-neutral API used by the service and CLI.

## Decision

`packages/ledger`'s `Ledger` class is written against a plain constructor-injected `db` handle and a `TrustPolicy` interface, with every write and read operation expressed as parameterized SQL issued through `better-sqlite3`'s prepared-statement API rather than through SQLite-specific query sugar (no `INSERT OR IGNORE`-style dialect-specific shortcuts beyond `ON CONFLICT DO UPDATE`, which PostgreSQL also supports natively). The `AppendResult`, `StoredEvent`, `LineageResult`, and `TrustPolicy` types in `packages/ledger/src/types.ts` are storage-neutral.

A future `PostgresLedgerAdapter` would implement the same constructor-and-method shape (or a shared `StorageAdapter` interface extracted from the current `Ledger` class) and pass the exact same test suite in `packages/ledger/src/__tests__/`, run twice — once per adapter — to demonstrate behavioral equivalence, per `PROMPT.md`'s "SQLite and PostgreSQL integration tests" requirement.

## Consequences

- The initial storage boundary consists of the constructor and public methods; no plugin system is introduced.
- The Definition of Done item "SQLite and PostgreSQL exhibit equivalent protocol behavior" is not met by this release and is tracked explicitly in `docs/roadmap.md`, not silently skipped.
