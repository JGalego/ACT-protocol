/**
 * Storage-neutral row shapes and the adapter contract every backing store
 * (SQLite, PostgreSQL) must implement. Extracted from `Ledger`'s previous
 * direct `better-sqlite3` usage so the write path in `ledger.ts` no longer
 * assumes a specific engine (docs/adr/0008-storage-adapter-and-postgres.md).
 *
 * Every method returns a Promise so one interface covers both a
 * synchronous driver (better-sqlite3, wrapped in already-resolved promises)
 * and an inherently asynchronous one (pg) without special-casing either in
 * `Ledger` itself.
 */

export interface EventRow {
  event_id: string;
  ledger_id: string;
  sequence: number;
  event_type: string;
  subject_kind: string | null;
  subject_artifact_id: string | null;
  subject_version_id: string | null;
  envelope_json: string;
  accepted_at: string;
  idempotency_key: string | null;
}

export interface ReceiptRow {
  ledger_id: string;
  sequence: number;
  event_id: string;
  accepted_at: string;
  previous_receipt_digest: string;
  receipt_digest: string;
  signature_json: string;
  source_receipt_json: string | null;
}

export interface CausalParentRow {
  event_id: string;
  parent_event_id: string;
  relation: string;
  is_missing: number;
}

export interface HeadRow {
  artifact_id: string;
  version_id: string;
  event_id: string;
  updated_at: string;
}

export interface QuarantineRow {
  id: string;
  reason: string;
  envelope_json: string;
  quarantined_at: string;
}

/** Everything a write transaction needs; every call happens against the same open transaction. */
export interface StorageTransaction {
  nextSequence(ledgerId: string): Promise<number>;
  getReceiptBySequence(ledgerId: string, sequence: number): Promise<ReceiptRow | null>;
  insertEvent(row: EventRow): Promise<void>;
  insertCausalParent(row: CausalParentRow): Promise<void>;
  insertReceipt(row: ReceiptRow): Promise<void>;
  upsertHead(row: HeadRow): Promise<void>;
}

export interface StorageAdapter {
  readonly dialect: 'sqlite' | 'postgres';

  /** Creates schema objects if absent and applies any pending migrations. Idempotent. */
  migrate(): Promise<void>;
  close(): Promise<void>;
  /** Whether the migration with this id has already been recorded as applied. Used only by the migration runner. */
  hasMigration(id: string): Promise<boolean>;

  /**
   * Runs `fn` inside one atomic transaction. On a detected write conflict
   * (concurrent append racing for the same sequence number), retries a
   * bounded number of times before throwing `StorageConflictError`.
   * SQLite can never actually race (its transactions are exclusive and
   * synchronous under the hood), so `SqliteAdapter` simply runs `fn` once.
   */
  withTransaction<T>(fn: (tx: StorageTransaction) => Promise<T>): Promise<T>;

  getEvent(eventId: string): Promise<EventRow | null>;
  findByIdempotencyKey(ledgerId: string, key: string): Promise<EventRow | null>;
  getReceiptByEventId(ledgerId: string, eventId: string): Promise<ReceiptRow | null>;
  getReceiptBySequence(ledgerId: string, sequence: number): Promise<ReceiptRow | null>;
  getHead(artifactId: string): Promise<HeadRow | null>;
  listEvents(ledgerId: string, limit: number, afterSequence: number): Promise<EventRow[]>;
  listEventsForArtifact(ledgerId: string, artifactId: string): Promise<EventRow[]>;
  getCausalParentsFor(eventId: string): Promise<CausalParentRow[]>;
  getChildrenOf(parentEventId: string): Promise<CausalParentRow[]>;
  /** Every lineage-relation causal-parent edge accepted by this ledger; drives cycle/fork/equivocation detection. */
  getAllCausalParents(): Promise<CausalParentRow[]>;

  insertQuarantine(row: QuarantineRow): Promise<void>;
  listQuarantine(): Promise<QuarantineRow[]>;

  /** Drops every projection table (heads) without touching the immutable event/receipt log. */
  clearProjections(): Promise<void>;
  upsertHead(row: HeadRow): Promise<void>;

  /** Raw statement execution; used only by the migration runner. */
  exec(sql: string): Promise<void>;
}
