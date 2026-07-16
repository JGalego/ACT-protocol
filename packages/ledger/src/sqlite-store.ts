import Database from 'better-sqlite3';

export type SqliteDatabase = Database.Database;

const SCHEMA_SQL = `
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
  UNIQUE (ledger_id, sequence)
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

/** Opens (creating if needed) a SQLite-backed ledger store and applies the schema. */
export function openSqliteStore(filename: string): SqliteDatabase {
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}

/** Drops every projection table (heads) without touching the immutable event/receipt log. */
export function clearProjections(db: SqliteDatabase): void {
  db.exec('DELETE FROM heads;');
}
