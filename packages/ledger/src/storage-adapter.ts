/**
 * Storage-neutral row shapes and the adapter contract every backing store
 * (SQLite, PostgreSQL) must implement. Extracted from `Ledger`'s previous
 * direct `better-sqlite3` usage so the write path in `ledger.ts` no longer
 * assumes a specific engine (docs/adr/0008-storage-adapter-and-postgres.md).
 *
 * Every read and write names the ledger it acts on (ADR 0010). Several
 * ledgers (one per tenant) share one database, and the type system, not
 * caller discipline, is what keeps a query from crossing between them.
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
  ledger_id: string;
  event_id: string;
  parent_event_id: string;
  relation: string;
  is_missing: number;
}

export interface HeadRow {
  ledger_id: string;
  artifact_id: string;
  version_id: string;
  event_id: string;
  updated_at: string;
}

export interface QuarantineRow {
  id: string;
  ledger_id: string;
  reason: string;
  envelope_json: string;
  quarantined_at: string;
}

export interface EventQueryFilter {
  /** Matches if event_type is any of these values (OR); omit to match every event_type. */
  eventTypes?: string[];
  subjectKind?: string;
}

/** Everything a write transaction needs; every call happens against the same open transaction. */
export interface StorageTransaction {
  nextSequence(ledgerId: string): Promise<number>;
  getReceiptBySequence(ledgerId: string, sequence: number): Promise<ReceiptRow | null>;
  insertEvent(row: EventRow): Promise<void>;
  insertCausalParent(row: CausalParentRow): Promise<void>;
  insertReceipt(row: ReceiptRow): Promise<void>;
  upsertHead(row: HeadRow): Promise<void>;
  /** Clears the missing-parent flag on every edge that named `parentEventId`, now that it has arrived. */
  resolveMissingParent(ledgerId: string, parentEventId: string): Promise<void>;
  /** Raw statement execution inside this transaction; used only by the migration runner. */
  exec(sql: string): Promise<void>;
  /** Whether the migration with this id is already recorded, read inside this transaction. */
  hasMigration(id: string): Promise<boolean>;
  /** Takes a cross-process lock held until the transaction ends (no-op where the engine is single-writer). */
  lockForMigration(): Promise<void>;
}

export interface StorageAdapter {
  readonly dialect: 'sqlite' | 'postgres';

  /** Creates schema objects if absent and applies any pending migrations. Idempotent. */
  migrate(): Promise<void>;
  close(): Promise<void>;

  /**
   * Runs `fn` inside one atomic transaction. On a detected write conflict
   * (concurrent append racing for the same sequence number), retries a
   * bounded number of times before throwing `StorageConflictError`.
   * SQLite can never actually race (its transactions are exclusive and
   * synchronous under the hood), so `SqliteAdapter` simply runs `fn` once.
   */
  withTransaction<T>(fn: (tx: StorageTransaction) => Promise<T>): Promise<T>;

  getEvent(ledgerId: string, eventId: string): Promise<EventRow | null>;
  findByIdempotencyKey(ledgerId: string, key: string): Promise<EventRow | null>;
  getReceiptByEventId(ledgerId: string, eventId: string): Promise<ReceiptRow | null>;
  getReceiptBySequence(ledgerId: string, sequence: number): Promise<ReceiptRow | null>;
  /** The ledger's last receipt, or null when it has none. */
  getHeadReceipt(ledgerId: string): Promise<ReceiptRow | null>;
  /** Receipts with sequence greater than `afterSequence`, oldest first. */
  listReceipts(ledgerId: string, afterSequence: number, limit: number): Promise<ReceiptRow[]>;
  getHead(ledgerId: string, artifactId: string): Promise<HeadRow | null>;
  listEvents(ledgerId: string, limit: number, afterSequence: number): Promise<EventRow[]>;
  listEventsForArtifact(ledgerId: string, artifactId: string): Promise<EventRow[]>;
  /**
   * Like listEvents, but narrowed by event_type and/or subject_kind --
   * both plain indexed columns, so this is a real filtered query, not an
   * in-memory scan. Filtering by actor is not supported here: actor
   * identity lives inside envelope_json, not a queryable column, and a
   * correct implementation would need a schema change (see
   * docs/roadmap.md) rather than a pagination-breaking in-memory filter.
   */
  queryEvents(
    ledgerId: string,
    filter: EventQueryFilter,
    limit: number,
    afterSequence: number,
  ): Promise<EventRow[]>;
  getCausalParentsFor(ledgerId: string, eventId: string): Promise<CausalParentRow[]>;
  getChildrenOf(ledgerId: string, parentEventId: string): Promise<CausalParentRow[]>;
  /** Every causal-parent edge accepted by this ledger; drives cycle/fork/equivocation detection. */
  getAllCausalParents(ledgerId: string): Promise<CausalParentRow[]>;

  insertQuarantine(row: QuarantineRow): Promise<void>;
  listQuarantine(ledgerId: string): Promise<QuarantineRow[]>;

  /** Drops one ledger's projection rows (heads) without touching the immutable event/receipt log or any other ledger. */
  clearProjections(ledgerId: string): Promise<void>;
  upsertHead(row: HeadRow): Promise<void>;

  /** Raw statement execution outside any transaction. */
  exec(sql: string): Promise<void>;

  /** Small durable key/value store for ledger-level metadata (identity, peers). Not part of the signed log. */
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
  /** Atomically stores `value` only if `key` is unset; returns whether this call stored it. */
  setMetaIfAbsent(key: string, value: string): Promise<boolean>;
  deleteMeta(key: string): Promise<boolean>;
  listMeta(prefix: string): Promise<{ key: string; value: string }[]>;
}
