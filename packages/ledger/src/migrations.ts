import type { StorageAdapter } from './storage-adapter.js';

export interface Migration {
  id: string;
  sql: string;
}

/**
 * Hand-rolled migration runner (no third-party migration library, per
 * ADR 0002's rationale for keeping core-package dependencies small and
 * auditable). Tracks applied migrations in a `schema_migrations` table and
 * runs each not-yet-applied migration's DDL inside its own transaction.
 */
export async function runMigrations(
  adapter: StorageAdapter,
  migrations: readonly Migration[],
): Promise<void> {
  await adapter.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  );
  for (const migration of migrations) {
    if (await adapter.hasMigration(migration.id)) continue;
    await adapter.withTransaction(async () => {
      await adapter.exec(migration.sql);
      await adapter.exec(
        `INSERT INTO schema_migrations (id, applied_at) VALUES ('${migration.id.replace(/'/g, "''")}', '${new Date().toISOString()}')`,
      );
    });
  }
}

export const SQLITE_INIT_SQL = `
CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  subject_kind TEXT,
  subject_artifact_id TEXT,
  subject_version_id TEXT,
  envelope_json TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  idempotency_key TEXT,
  UNIQUE (ledger_id, sequence),
  UNIQUE (ledger_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_events_subject_artifact ON events (subject_artifact_id);

CREATE TABLE IF NOT EXISTS causal_parents (
  event_id TEXT NOT NULL,
  parent_event_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  is_missing INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, parent_event_id)
);

CREATE INDEX IF NOT EXISTS idx_causal_parents_parent ON causal_parents (parent_event_id);

CREATE TABLE IF NOT EXISTS receipts (
  ledger_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  previous_receipt_digest TEXT NOT NULL,
  receipt_digest TEXT NOT NULL,
  signature_json TEXT NOT NULL,
  source_receipt_json TEXT,
  PRIMARY KEY (ledger_id, sequence)
);

CREATE TABLE IF NOT EXISTS heads (
  artifact_id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quarantine (
  id TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  envelope_json TEXT NOT NULL,
  quarantined_at TEXT NOT NULL
);
`;

// Postgres DDL is intentionally near-identical to SQLite's -- both engines
// accept TEXT primary keys and ON CONFLICT DO UPDATE natively (ADR 0004),
// so a single shared dialect needs no per-engine branching here.
export const POSTGRES_INIT_SQL = SQLITE_INIT_SQL;

export const SQLITE_MIGRATIONS: readonly Migration[] = [{ id: '0001-init', sql: SQLITE_INIT_SQL }];
export const POSTGRES_MIGRATIONS: readonly Migration[] = [
  { id: '0001-init', sql: POSTGRES_INIT_SQL },
];
