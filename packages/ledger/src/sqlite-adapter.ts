import Database from 'better-sqlite3';
import type {
  CausalParentRow,
  EventRow,
  HeadRow,
  QuarantineRow,
  ReceiptRow,
  StorageAdapter,
  StorageTransaction,
} from './storage-adapter.js';
import { runMigrations, SQLITE_MIGRATIONS } from './migrations.js';

export type SqliteDatabase = Database.Database;

class SqliteTransaction implements StorageTransaction {
  constructor(private readonly db: SqliteDatabase) {}

  async nextSequence(ledgerId: string): Promise<number> {
    const row = this.db
      .prepare('SELECT MAX(sequence) AS maxSeq FROM receipts WHERE ledger_id = ?')
      .get(ledgerId) as { maxSeq: number | null };
    return row.maxSeq === null ? 0 : row.maxSeq + 1;
  }

  async getReceiptBySequence(ledgerId: string, sequence: number): Promise<ReceiptRow | null> {
    const row = this.db
      .prepare('SELECT * FROM receipts WHERE ledger_id = ? AND sequence = ?')
      .get(ledgerId, sequence) as ReceiptRow | undefined;
    return row ?? null;
  }

  async insertEvent(row: EventRow): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO events (event_id, ledger_id, sequence, event_type, subject_kind, subject_artifact_id, subject_version_id, envelope_json, accepted_at, idempotency_key)
         VALUES (@event_id, @ledger_id, @sequence, @event_type, @subject_kind, @subject_artifact_id, @subject_version_id, @envelope_json, @accepted_at, @idempotency_key)`,
      )
      .run(row);
  }

  async insertCausalParent(row: CausalParentRow): Promise<void> {
    this.db
      .prepare(
        'INSERT INTO causal_parents (event_id, parent_event_id, relation, is_missing) VALUES (@event_id, @parent_event_id, @relation, @is_missing)',
      )
      .run(row);
  }

  async insertReceipt(row: ReceiptRow): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO receipts (ledger_id, sequence, event_id, accepted_at, previous_receipt_digest, receipt_digest, signature_json, source_receipt_json)
         VALUES (@ledger_id, @sequence, @event_id, @accepted_at, @previous_receipt_digest, @receipt_digest, @signature_json, @source_receipt_json)`,
      )
      .run(row);
  }

  async upsertHead(row: HeadRow): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO heads (artifact_id, version_id, event_id, updated_at) VALUES (@artifact_id, @version_id, @event_id, @updated_at)
         ON CONFLICT(artifact_id) DO UPDATE SET version_id = excluded.version_id, event_id = excluded.event_id, updated_at = excluded.updated_at`,
      )
      .run(row);
  }
}

export class SqliteAdapter implements StorageAdapter {
  readonly dialect = 'sqlite' as const;

  constructor(private readonly db: SqliteDatabase) {}

  /** Test/debug-only escape hatch to the raw better-sqlite3 handle; not part of the StorageAdapter contract. */
  raw(): SqliteDatabase {
    return this.db;
  }

  static open(filename: string): SqliteAdapter {
    const db = new Database(filename);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    return new SqliteAdapter(db);
  }

  async migrate(): Promise<void> {
    await runMigrations(this, SQLITE_MIGRATIONS);
  }

  async close(): Promise<void> {
    this.db.close();
  }

  async hasMigration(id: string): Promise<boolean> {
    const row = this.db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?').get(id) as unknown;
    return row !== undefined;
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async withTransaction<T>(fn: (tx: StorageTransaction) => Promise<T>): Promise<T> {
    // better-sqlite3's `db.transaction(cb)` helper requires `cb` to be
    // synchronous, which `fn` (an async function per the StorageAdapter
    // contract, so PostgresAdapter can genuinely await network I/O inside
    // it) is not. Driving BEGIN/COMMIT/ROLLBACK explicitly on the
    // connection is correct here instead: better-sqlite3 holds a single
    // connection, Node is single-threaded, and nothing else touches this
    // handle while `fn` runs, so there is no interleaving to guard against.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = await fn(new SqliteTransaction(this.db));
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async getEvent(eventId: string): Promise<EventRow | null> {
    const row = this.db.prepare('SELECT * FROM events WHERE event_id = ?').get(eventId) as
      EventRow | undefined;
    return row ?? null;
  }

  async findByIdempotencyKey(ledgerId: string, key: string): Promise<EventRow | null> {
    const row = this.db
      .prepare('SELECT * FROM events WHERE ledger_id = ? AND idempotency_key = ?')
      .get(ledgerId, key) as EventRow | undefined;
    return row ?? null;
  }

  async getReceiptByEventId(ledgerId: string, eventId: string): Promise<ReceiptRow | null> {
    const row = this.db
      .prepare('SELECT * FROM receipts WHERE ledger_id = ? AND event_id = ?')
      .get(ledgerId, eventId) as ReceiptRow | undefined;
    return row ?? null;
  }

  async getReceiptBySequence(ledgerId: string, sequence: number): Promise<ReceiptRow | null> {
    const row = this.db
      .prepare('SELECT * FROM receipts WHERE ledger_id = ? AND sequence = ?')
      .get(ledgerId, sequence) as ReceiptRow | undefined;
    return row ?? null;
  }

  async getHead(artifactId: string): Promise<HeadRow | null> {
    const row = this.db.prepare('SELECT * FROM heads WHERE artifact_id = ?').get(artifactId) as
      HeadRow | undefined;
    return row ?? null;
  }

  async listEvents(ledgerId: string, limit: number, afterSequence: number): Promise<EventRow[]> {
    return this.db
      .prepare(
        'SELECT * FROM events WHERE ledger_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT ?',
      )
      .all(ledgerId, afterSequence, limit) as EventRow[];
  }

  async listEventsForArtifact(ledgerId: string, artifactId: string): Promise<EventRow[]> {
    return this.db
      .prepare(
        'SELECT * FROM events WHERE ledger_id = ? AND subject_artifact_id = ? ORDER BY sequence ASC',
      )
      .all(ledgerId, artifactId) as EventRow[];
  }

  async getCausalParentsFor(eventId: string): Promise<CausalParentRow[]> {
    return this.db
      .prepare('SELECT * FROM causal_parents WHERE event_id = ?')
      .all(eventId) as CausalParentRow[];
  }

  async getChildrenOf(parentEventId: string): Promise<CausalParentRow[]> {
    return this.db
      .prepare('SELECT * FROM causal_parents WHERE parent_event_id = ?')
      .all(parentEventId) as CausalParentRow[];
  }

  async getAllCausalParents(): Promise<CausalParentRow[]> {
    return this.db.prepare('SELECT * FROM causal_parents').all() as CausalParentRow[];
  }

  async insertQuarantine(row: QuarantineRow): Promise<void> {
    this.db
      .prepare(
        'INSERT INTO quarantine (id, reason, envelope_json, quarantined_at) VALUES (@id, @reason, @envelope_json, @quarantined_at)',
      )
      .run(row);
  }

  async listQuarantine(): Promise<QuarantineRow[]> {
    return this.db
      .prepare('SELECT * FROM quarantine ORDER BY quarantined_at ASC')
      .all() as QuarantineRow[];
  }

  async clearProjections(): Promise<void> {
    this.db.exec('DELETE FROM heads;');
  }

  async upsertHead(row: HeadRow): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO heads (artifact_id, version_id, event_id, updated_at) VALUES (@artifact_id, @version_id, @event_id, @updated_at)
         ON CONFLICT(artifact_id) DO UPDATE SET version_id = excluded.version_id, event_id = excluded.event_id, updated_at = excluded.updated_at`,
      )
      .run(row);
  }
}
