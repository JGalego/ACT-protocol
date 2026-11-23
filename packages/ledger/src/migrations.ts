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
  for (const migration of migrations) {
    // The applied-check runs inside the same transaction (and, on Postgres,
    // under an advisory lock) so that replicas booting at once neither apply
    // a migration twice nor observe it half-applied.
    await adapter.withTransaction(async (tx) => {
      await tx.lockForMigration();
      await tx.exec(
        'CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
      );
      if (await tx.hasMigration(migration.id)) return;
      await tx.exec(migration.sql);
      await tx.exec(
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

const META_SQL = `
CREATE TABLE IF NOT EXISTS ledger_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

// 0003-tenant-scoping (ADR 0010): several ledgers (one per tenant) share one
// database, so everything that identifies a row must include the ledger. Rows
// that predate it belong to the one ledger that existed: events and receipts
// already carry `ledger_id`, edges and heads inherit it from their event, and a
// quarantine id was always `<ledger id>:...`. SQLite cannot alter a primary
// key, so its tables are rebuilt; PostgreSQL alters them in place.
const SQLITE_TENANT_SCOPING_SQL = `
CREATE TABLE events_scoped (
  event_id TEXT NOT NULL,
  ledger_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  subject_kind TEXT,
  subject_artifact_id TEXT,
  subject_version_id TEXT,
  envelope_json TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  idempotency_key TEXT,
  PRIMARY KEY (ledger_id, event_id),
  UNIQUE (ledger_id, sequence),
  UNIQUE (ledger_id, idempotency_key)
);
INSERT INTO events_scoped SELECT event_id, ledger_id, sequence, event_type, subject_kind, subject_artifact_id, subject_version_id, envelope_json, accepted_at, idempotency_key FROM events;

CREATE TABLE causal_parents_scoped (
  ledger_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  parent_event_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  is_missing INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ledger_id, event_id, parent_event_id)
);
INSERT INTO causal_parents_scoped
  SELECT (SELECT e.ledger_id FROM events e WHERE e.event_id = cp.event_id), cp.event_id, cp.parent_event_id, cp.relation, cp.is_missing
  FROM causal_parents cp;

CREATE TABLE heads_scoped (
  ledger_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (ledger_id, artifact_id)
);
INSERT INTO heads_scoped
  SELECT (SELECT e.ledger_id FROM events e WHERE e.event_id = h.event_id), h.artifact_id, h.version_id, h.event_id, h.updated_at
  FROM heads h;

CREATE TABLE quarantine_scoped (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  envelope_json TEXT NOT NULL,
  quarantined_at TEXT NOT NULL
);
INSERT INTO quarantine_scoped
  SELECT id, substr(id, 1, instr(id, ':') - 1), reason, envelope_json, quarantined_at FROM quarantine;

DROP TABLE events;
DROP TABLE causal_parents;
DROP TABLE heads;
DROP TABLE quarantine;
ALTER TABLE events_scoped RENAME TO events;
ALTER TABLE causal_parents_scoped RENAME TO causal_parents;
ALTER TABLE heads_scoped RENAME TO heads;
ALTER TABLE quarantine_scoped RENAME TO quarantine;

CREATE INDEX idx_events_subject_artifact ON events (ledger_id, subject_artifact_id);
CREATE INDEX idx_causal_parents_parent ON causal_parents (ledger_id, parent_event_id);
CREATE INDEX idx_quarantine_ledger ON quarantine (ledger_id);
`;

const POSTGRES_TENANT_SCOPING_SQL = `
ALTER TABLE events DROP CONSTRAINT events_pkey;
ALTER TABLE events ADD PRIMARY KEY (ledger_id, event_id);
DROP INDEX IF EXISTS idx_events_subject_artifact;
CREATE INDEX idx_events_subject_artifact ON events (ledger_id, subject_artifact_id);

ALTER TABLE causal_parents ADD COLUMN ledger_id TEXT;
UPDATE causal_parents SET ledger_id = (SELECT e.ledger_id FROM events e WHERE e.event_id = causal_parents.event_id LIMIT 1);
ALTER TABLE causal_parents ALTER COLUMN ledger_id SET NOT NULL;
ALTER TABLE causal_parents DROP CONSTRAINT causal_parents_pkey;
ALTER TABLE causal_parents ADD PRIMARY KEY (ledger_id, event_id, parent_event_id);
DROP INDEX IF EXISTS idx_causal_parents_parent;
CREATE INDEX idx_causal_parents_parent ON causal_parents (ledger_id, parent_event_id);

ALTER TABLE heads ADD COLUMN ledger_id TEXT;
UPDATE heads SET ledger_id = (SELECT e.ledger_id FROM events e WHERE e.event_id = heads.event_id LIMIT 1);
ALTER TABLE heads ALTER COLUMN ledger_id SET NOT NULL;
ALTER TABLE heads DROP CONSTRAINT heads_pkey;
ALTER TABLE heads ADD PRIMARY KEY (ledger_id, artifact_id);

ALTER TABLE quarantine ADD COLUMN ledger_id TEXT;
UPDATE quarantine SET ledger_id = split_part(id, ':', 1);
ALTER TABLE quarantine ALTER COLUMN ledger_id SET NOT NULL;
CREATE INDEX idx_quarantine_ledger ON quarantine (ledger_id);
`;

export const SQLITE_MIGRATIONS: readonly Migration[] = [
  { id: '0001-init', sql: SQLITE_INIT_SQL },
  { id: '0002-ledger-meta', sql: META_SQL },
  { id: '0003-tenant-scoping', sql: SQLITE_TENANT_SCOPING_SQL },
];
export const POSTGRES_MIGRATIONS: readonly Migration[] = [
  { id: '0001-init', sql: POSTGRES_INIT_SQL },
  { id: '0002-ledger-meta', sql: META_SQL },
  { id: '0003-tenant-scoping', sql: POSTGRES_TENANT_SCOPING_SQL },
];
