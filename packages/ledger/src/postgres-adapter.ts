import pg from 'pg';
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
import { runMigrations, POSTGRES_MIGRATIONS } from './migrations.js';
import { StorageConflictError } from './errors.js';

const { Pool } = pg;
type PoolClient = pg.PoolClient;

const MAX_TRANSACTION_ATTEMPTS = 8;

function isRetryableConflict(err: unknown): boolean {
  const code = (err as { code?: string } | undefined)?.code;
  return code === '40001' /* serialization_failure */ || code === '23505'; /* unique_violation */
}

/** Small randomized backoff so many simultaneously-retrying transactions don't keep re-colliding on the same recomputed sequence number in lockstep. */
function jitterBackoffMs(attempt: number): number {
  return Math.floor(Math.random() * attempt * 15);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class PostgresTransaction implements StorageTransaction {
  constructor(private readonly client: PoolClient) {}

  async nextSequence(ledgerId: string): Promise<number> {
    const result = await this.client.query(
      'SELECT MAX(sequence) AS "maxSeq" FROM receipts WHERE ledger_id = $1',
      [ledgerId],
    );
    const maxSeq = result.rows[0]?.maxSeq;
    return maxSeq === null || maxSeq === undefined ? 0 : Number(maxSeq) + 1;
  }

  async getReceiptBySequence(ledgerId: string, sequence: number): Promise<ReceiptRow | null> {
    const result = await this.client.query(
      'SELECT * FROM receipts WHERE ledger_id = $1 AND sequence = $2',
      [ledgerId, sequence],
    );
    return (result.rows[0] as ReceiptRow | undefined) ?? null;
  }

  async insertEvent(row: EventRow): Promise<void> {
    await this.client.query(
      `INSERT INTO events (event_id, ledger_id, sequence, event_type, subject_kind, subject_artifact_id, subject_version_id, envelope_json, accepted_at, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        row.event_id,
        row.ledger_id,
        row.sequence,
        row.event_type,
        row.subject_kind,
        row.subject_artifact_id,
        row.subject_version_id,
        row.envelope_json,
        row.accepted_at,
        row.idempotency_key,
      ],
    );
  }

  async insertCausalParent(row: CausalParentRow): Promise<void> {
    await this.client.query(
      'INSERT INTO causal_parents (event_id, parent_event_id, relation, is_missing) VALUES ($1, $2, $3, $4)',
      [row.event_id, row.parent_event_id, row.relation, row.is_missing],
    );
  }

  async insertReceipt(row: ReceiptRow): Promise<void> {
    await this.client.query(
      `INSERT INTO receipts (ledger_id, sequence, event_id, accepted_at, previous_receipt_digest, receipt_digest, signature_json, source_receipt_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        row.ledger_id,
        row.sequence,
        row.event_id,
        row.accepted_at,
        row.previous_receipt_digest,
        row.receipt_digest,
        row.signature_json,
        row.source_receipt_json,
      ],
    );
  }

  async upsertHead(row: HeadRow): Promise<void> {
    await this.client.query(
      `INSERT INTO heads (artifact_id, version_id, event_id, updated_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (artifact_id) DO UPDATE SET version_id = excluded.version_id, event_id = excluded.event_id, updated_at = excluded.updated_at`,
      [row.artifact_id, row.version_id, row.event_id, row.updated_at],
    );
  }
}

/**
 * PostgreSQL-backed StorageAdapter, behaviorally equivalent to SqliteAdapter
 * (proven by running the same ledger test suite against both -- see
 * ledger.postgres.test.ts). Uses `pg` directly with plain parameterized
 * queries, consistent with this repo's existing avoidance of query-builder
 * DSLs (ADR 0002).
 */
export class PostgresAdapter implements StorageAdapter {
  readonly dialect = 'postgres' as const;
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
    // node-postgres emits 'error' on the pool for problems with *idle*
    // clients (e.g. the server terminating a connection during a restart
    // or, in tests, embedded-postgres shutting down while an idle
    // connection still sits in the pool). With no listener, Node's
    // EventEmitter treats an unhandled 'error' event as fatal. This isn't
    // a query failure -- in-flight queries still reject normally through
    // their own promise -- so there is nothing to do here beyond
    // preventing that crash.
    this.pool.on('error', () => undefined);
  }

  async migrate(): Promise<void> {
    await runMigrations(this, POSTGRES_MIGRATIONS);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async hasMigration(id: string): Promise<boolean> {
    const result = await this.pool.query('SELECT 1 FROM schema_migrations WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async withTransaction<T>(fn: (tx: StorageTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt++) {
        try {
          await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
          const result = await fn(new PostgresTransaction(client));
          await client.query('COMMIT');
          return result;
        } catch (err) {
          await client.query('ROLLBACK').catch(() => undefined);
          if (isRetryableConflict(err) && attempt < MAX_TRANSACTION_ATTEMPTS) {
            await sleep(jitterBackoffMs(attempt));
            continue;
          }
          if (isRetryableConflict(err)) throw new StorageConflictError();
          throw err;
        }
      }
      /* v8 ignore next -- unreachable: the loop body above always either returns or throws on its final iteration */
      throw new StorageConflictError();
    } finally {
      client.release();
    }
  }

  async getEvent(eventId: string): Promise<EventRow | null> {
    const result = await this.pool.query('SELECT * FROM events WHERE event_id = $1', [eventId]);
    return (result.rows[0] as EventRow | undefined) ?? null;
  }

  async findByIdempotencyKey(ledgerId: string, key: string): Promise<EventRow | null> {
    const result = await this.pool.query(
      'SELECT * FROM events WHERE ledger_id = $1 AND idempotency_key = $2',
      [ledgerId, key],
    );
    return (result.rows[0] as EventRow | undefined) ?? null;
  }

  async getReceiptByEventId(ledgerId: string, eventId: string): Promise<ReceiptRow | null> {
    const result = await this.pool.query(
      'SELECT * FROM receipts WHERE ledger_id = $1 AND event_id = $2',
      [ledgerId, eventId],
    );
    return (result.rows[0] as ReceiptRow | undefined) ?? null;
  }

  async getReceiptBySequence(ledgerId: string, sequence: number): Promise<ReceiptRow | null> {
    const result = await this.pool.query(
      'SELECT * FROM receipts WHERE ledger_id = $1 AND sequence = $2',
      [ledgerId, sequence],
    );
    return (result.rows[0] as ReceiptRow | undefined) ?? null;
  }

  async getHead(artifactId: string): Promise<HeadRow | null> {
    const result = await this.pool.query('SELECT * FROM heads WHERE artifact_id = $1', [
      artifactId,
    ]);
    return (result.rows[0] as HeadRow | undefined) ?? null;
  }

  async listEvents(ledgerId: string, limit: number, afterSequence: number): Promise<EventRow[]> {
    const result = await this.pool.query(
      'SELECT * FROM events WHERE ledger_id = $1 AND sequence > $2 ORDER BY sequence ASC LIMIT $3',
      [ledgerId, afterSequence, limit],
    );
    return result.rows as EventRow[];
  }

  async listEventsForArtifact(ledgerId: string, artifactId: string): Promise<EventRow[]> {
    const result = await this.pool.query(
      'SELECT * FROM events WHERE ledger_id = $1 AND subject_artifact_id = $2 ORDER BY sequence ASC',
      [ledgerId, artifactId],
    );
    return result.rows as EventRow[];
  }

  async queryEvents(
    ledgerId: string,
    filter: EventQueryFilter,
    limit: number,
    afterSequence: number,
  ): Promise<EventRow[]> {
    const conditions = ['ledger_id = $1', 'sequence > $2'];
    const params: (string | number | string[])[] = [ledgerId, afterSequence];
    if (filter.eventTypes && filter.eventTypes.length > 0) {
      params.push(filter.eventTypes);
      conditions.push(`event_type = ANY($${params.length})`);
    }
    if (filter.subjectKind) {
      params.push(filter.subjectKind);
      conditions.push(`subject_kind = $${params.length}`);
    }
    params.push(limit);
    const result = await this.pool.query(
      `SELECT * FROM events WHERE ${conditions.join(' AND ')} ORDER BY sequence ASC LIMIT $${params.length}`,
      params,
    );
    return result.rows as EventRow[];
  }

  async getCausalParentsFor(eventId: string): Promise<CausalParentRow[]> {
    const result = await this.pool.query('SELECT * FROM causal_parents WHERE event_id = $1', [
      eventId,
    ]);
    return result.rows as CausalParentRow[];
  }

  async getChildrenOf(parentEventId: string): Promise<CausalParentRow[]> {
    const result = await this.pool.query(
      'SELECT * FROM causal_parents WHERE parent_event_id = $1',
      [parentEventId],
    );
    return result.rows as CausalParentRow[];
  }

  async getAllCausalParents(): Promise<CausalParentRow[]> {
    const result = await this.pool.query('SELECT * FROM causal_parents');
    return result.rows as CausalParentRow[];
  }

  async insertQuarantine(row: QuarantineRow): Promise<void> {
    await this.pool.query(
      'INSERT INTO quarantine (id, reason, envelope_json, quarantined_at) VALUES ($1, $2, $3, $4)',
      [row.id, row.reason, row.envelope_json, row.quarantined_at],
    );
  }

  async listQuarantine(): Promise<QuarantineRow[]> {
    const result = await this.pool.query('SELECT * FROM quarantine ORDER BY quarantined_at ASC');
    return result.rows as QuarantineRow[];
  }

  async clearProjections(): Promise<void> {
    await this.pool.query('DELETE FROM heads');
  }

  async upsertHead(row: HeadRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO heads (artifact_id, version_id, event_id, updated_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (artifact_id) DO UPDATE SET version_id = excluded.version_id, event_id = excluded.event_id, updated_at = excluded.updated_at`,
      [row.artifact_id, row.version_id, row.event_id, row.updated_at],
    );
  }
}
