import Database from 'better-sqlite3';
import type {
  CausalParentRow,
  EventQueryFilter,
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
        'INSERT INTO causal_parents (ledger_id, event_id, parent_event_id, relation, is_missing) VALUES (@ledger_id, @event_id, @parent_event_id, @relation, @is_missing)',
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
        `INSERT INTO heads (ledger_id, artifact_id, version_id, event_id, updated_at) VALUES (@ledger_id, @artifact_id, @version_id, @event_id, @updated_at)
         ON CONFLICT(ledger_id, artifact_id) DO UPDATE SET version_id = excluded.version_id, event_id = excluded.event_id, updated_at = excluded.updated_at`,
      )
      .run(row);
  }

  async resolveMissingParent(ledgerId: string, parentEventId: string): Promise<void> {
    this.db
      .prepare(
        'UPDATE causal_parents SET is_missing = 0 WHERE ledger_id = ? AND parent_event_id = ?',
      )
      .run(ledgerId, parentEventId);
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async hasMigration(id: string): Promise<boolean> {
    const row = this.db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?').get(id) as unknown;
    return row !== undefined;
  }

  async lockForMigration(): Promise<void> {
    // BEGIN IMMEDIATE already holds SQLite's single write lock.
  }
}

export class SqliteAdapter implements StorageAdapter {
  readonly dialect = 'sqlite' as const;
  /**
   * Tail of the transaction queue. better-sqlite3 has one connection, and a
   * transaction here spans awaits, so two overlapping appends would otherwise
   * issue BEGIN inside an open transaction. Transactions run strictly one at a
   * time instead.
   */
  private txQueue: Promise<unknown> = Promise.resolve();

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

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async withTransaction<T>(fn: (tx: StorageTransaction) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn(new SqliteTransaction(this.db));
        this.db.exec('COMMIT');
        return result;
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    };
    const next = this.txQueue.then(run, run);
    this.txQueue = next.catch(() => undefined);
    return next;
  }

  async getEvent(ledgerId: string, eventId: string): Promise<EventRow | null> {
    const row = this.db
      .prepare('SELECT * FROM events WHERE ledger_id = ? AND event_id = ?')
      .get(ledgerId, eventId) as EventRow | undefined;
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

  async getHead(ledgerId: string, artifactId: string): Promise<HeadRow | null> {
    const row = this.db
      .prepare('SELECT * FROM heads WHERE ledger_id = ? AND artifact_id = ?')
      .get(ledgerId, artifactId) as HeadRow | undefined;
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

  async queryEvents(
    ledgerId: string,
    filter: EventQueryFilter,
    limit: number,
    afterSequence: number,
  ): Promise<EventRow[]> {
    const conditions = ['ledger_id = ?', 'sequence > ?'];
    const params: (string | number)[] = [ledgerId, afterSequence];
    if (filter.eventTypes && filter.eventTypes.length > 0) {
      conditions.push(`event_type IN (${filter.eventTypes.map(() => '?').join(',')})`);
      params.push(...filter.eventTypes);
    }
    if (filter.subjectKind) {
      conditions.push('subject_kind = ?');
      params.push(filter.subjectKind);
    }
    params.push(limit);
    return this.db
      .prepare(
        `SELECT * FROM events WHERE ${conditions.join(' AND ')} ORDER BY sequence ASC LIMIT ?`,
      )
      .all(...params) as EventRow[];
  }

  async getCausalParentsFor(ledgerId: string, eventId: string): Promise<CausalParentRow[]> {
    return this.db
      .prepare('SELECT * FROM causal_parents WHERE ledger_id = ? AND event_id = ?')
      .all(ledgerId, eventId) as CausalParentRow[];
  }

  async getChildrenOf(ledgerId: string, parentEventId: string): Promise<CausalParentRow[]> {
    return this.db
      .prepare('SELECT * FROM causal_parents WHERE ledger_id = ? AND parent_event_id = ?')
      .all(ledgerId, parentEventId) as CausalParentRow[];
  }

  async getAllCausalParents(ledgerId: string): Promise<CausalParentRow[]> {
    return this.db
      .prepare('SELECT * FROM causal_parents WHERE ledger_id = ?')
      .all(ledgerId) as CausalParentRow[];
  }

  async insertQuarantine(row: QuarantineRow): Promise<void> {
    this.db
      .prepare(
        'INSERT INTO quarantine (id, ledger_id, reason, envelope_json, quarantined_at) VALUES (@id, @ledger_id, @reason, @envelope_json, @quarantined_at)',
      )
      .run(row);
  }

  async listQuarantine(ledgerId: string): Promise<QuarantineRow[]> {
    return this.db
      .prepare('SELECT * FROM quarantine WHERE ledger_id = ? ORDER BY quarantined_at ASC')
      .all(ledgerId) as QuarantineRow[];
  }

  async clearProjections(ledgerId: string): Promise<void> {
    this.db.prepare('DELETE FROM heads WHERE ledger_id = ?').run(ledgerId);
  }

  async upsertHead(row: HeadRow): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO heads (ledger_id, artifact_id, version_id, event_id, updated_at) VALUES (@ledger_id, @artifact_id, @version_id, @event_id, @updated_at)
         ON CONFLICT(ledger_id, artifact_id) DO UPDATE SET version_id = excluded.version_id, event_id = excluded.event_id, updated_at = excluded.updated_at`,
      )
      .run(row);
  }

  async getMeta(key: string): Promise<string | null> {
    const row = this.db.prepare('SELECT value FROM ledger_meta WHERE key = ?').get(key) as
      { value: string } | undefined;
    return row?.value ?? null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    this.db
      .prepare(
        'INSERT INTO ledger_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value);
  }

  async setMetaIfAbsent(key: string, value: string): Promise<boolean> {
    const result = this.db
      .prepare('INSERT INTO ledger_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING')
      .run(key, value);
    return result.changes > 0;
  }

  async deleteMeta(key: string): Promise<boolean> {
    return this.db.prepare('DELETE FROM ledger_meta WHERE key = ?').run(key).changes > 0;
  }

  async listMeta(prefix: string): Promise<{ key: string; value: string }[]> {
    return this.db
      .prepare("SELECT key, value FROM ledger_meta WHERE key LIKE ? ESCAPE '\\' ORDER BY key")
      .all(`${prefix.replace(/[\\%_]/g, '\\$&')}%`) as { key: string; value: string }[];
  }
}
