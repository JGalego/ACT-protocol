import { SCHEMA_IDS, validateAgainst } from '@act/core';
import { verifyEnvelope, type SignedEnvelope } from '@act/crypto';
import type { SqliteDatabase } from './sqlite-store.js';
import { clearProjections } from './sqlite-store.js';
import { LINEAGE_RELATIONS, detectCycle } from './cycle.js';
import { GENESIS_RECEIPT_DIGEST, issueReceipt, type LedgerReceipt } from './receipts.js';
import {
  CycleDetectedError,
  DigestMismatchError,
  InvalidSignatureError,
  MissingParentError,
  SchemaValidationError,
  UntrustedActorError,
} from './errors.js';
import type {
  AppendOptions,
  AppendResult,
  LineageBoundary,
  LineageResult,
  StoredEvent,
  TrustPolicy,
} from './types.js';

export interface LedgerSigner {
  keyId: string;
  publicKey: string;
  privateKey: string;
}

export interface LedgerOptions {
  ledgerId: string;
  db: SqliteDatabase;
  signer: LedgerSigner;
  trustPolicy: TrustPolicy;
  /** Overridable for deterministic tests; defaults to `new Date().toISOString()`. */
  now?: () => string;
}

/**
 * A single-node, SQLite-backed, hash-chained event ledger implementing the
 * atomic write path from ACT-1.0.md section 6.1.
 */
export class Ledger {
  readonly ledgerId: string;
  private readonly db: SqliteDatabase;
  private readonly signer: LedgerSigner;
  private readonly trustPolicy: TrustPolicy;
  private readonly now: () => string;

  constructor(options: LedgerOptions) {
    this.ledgerId = options.ledgerId;
    this.db = options.db;
    this.signer = options.signer;
    this.trustPolicy = options.trustPolicy;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /**
   * Appends a signed event, performing every step of the write path
   * atomically in a single SQLite transaction. Throws a subclass of
   * LedgerError identifying exactly which step failed.
   */
  appendEvent(envelope: SignedEnvelope, options: AppendOptions): AppendResult {
    // Step 1: schema and limit validation.
    const schemaResult = validateAgainst(SCHEMA_IDS.unsignedEvent, envelope.payload);
    if (!schemaResult.valid) {
      throw new SchemaValidationError(JSON.stringify(schemaResult.errors));
    }

    // Step 2: recompute identifiers and digests; step 3: verify signatures and key bindings.
    const verification = verifyEnvelope(envelope, options.publicKeys);
    if (!verification.digestValid) {
      throw new DigestMismatchError(envelope.payloadDigest, '(recomputed digest did not match)');
    }
    const invalidSignature = verification.signatures.find((s) => !s.valid);
    if (invalidSignature) {
      throw new InvalidSignatureError(invalidSignature.key_id);
    }
    const eventId = envelope.payloadDigest;

    // Duplicate check: idempotent no-op returning the existing receipt.
    const existing = this.getEventRow(eventId);
    if (existing) {
      const receiptRow = this.db
        .prepare('SELECT * FROM receipts WHERE ledger_id = ? AND event_id = ?')
        .get(this.ledgerId, eventId) as ReceiptRow | undefined;
      if (!receiptRow) {
        throw new Error(`Invariant violated: accepted event ${eventId} has no receipt`);
      }
      return {
        event: rowToStoredEvent(existing),
        receipt: receiptRowToReceipt(receiptRow),
        duplicate: true,
      };
    }

    // Step 4: evaluate trust policy.
    const actorId = (envelope.payload as { actor: { actor_id: string; key_id: string } }).actor
      .actor_id;
    const actorKeyId = (envelope.payload as { actor: { actor_id: string; key_id: string } }).actor
      .key_id;
    if (!this.trustPolicy.isTrusted(actorId, actorKeyId)) {
      throw new UntrustedActorError(actorId, actorKeyId);
    }

    // Step 5: verify causal parents exist, or mark a permitted partial import.
    const causalParents = (
      (envelope.payload as { causal_parents: { event_id: string; relation?: string }[] })
        .causal_parents ?? []
    ).map((p) => ({ event_id: p.event_id, relation: p.relation ?? 'input' }));
    const missingParentIds = causalParents
      .map((p) => p.event_id)
      .filter((parentId) => !this.getEventRow(parentId));
    if (missingParentIds.length > 0 && !options.allowPartialImport) {
      throw new MissingParentError(missingParentIds);
    }

    // Step 6: reject cycles (over lineage-typed relations only).
    const lineageParentIds = causalParents
      .filter((p) => LINEAGE_RELATIONS.has(p.relation))
      .map((p) => p.event_id);
    const existingEdges = this.buildForwardEdgeMap();
    const cycle = detectCycle(existingEdges, eventId, lineageParentIds);
    if (cycle) {
      throw new CycleDetectedError(cycle);
    }

    // Steps 7-9: append event + receipt, update projections, all in one transaction.
    const sequence = this.nextSequence();
    const acceptedAt = this.now();
    const subject = envelope.payload.subject as {
      kind?: string;
      artifact_id?: string;
      version_id?: string;
    };

    const previousReceipt = sequence === 0 ? null : this.getReceiptBySequence(sequence - 1);
    const previousReceiptDigest =
      sequence === 0 ? GENESIS_RECEIPT_DIGEST : previousReceipt!.receipt_digest;
    const receipt = issueReceipt(
      {
        ledger_id: this.ledgerId,
        sequence,
        event_id: eventId,
        accepted_at: acceptedAt,
        previous_receipt_digest: previousReceiptDigest,
      },
      this.signer,
    );

    const txn = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO events (event_id, ledger_id, sequence, event_type, subject_kind, subject_artifact_id, subject_version_id, envelope_json, accepted_at)
           VALUES (@event_id, @ledger_id, @sequence, @event_type, @subject_kind, @subject_artifact_id, @subject_version_id, @envelope_json, @accepted_at)`,
        )
        .run({
          event_id: eventId,
          ledger_id: this.ledgerId,
          sequence,
          event_type: envelope.payload.event_type,
          subject_kind: subject.kind ?? null,
          subject_artifact_id: subject.artifact_id ?? null,
          subject_version_id: subject.version_id ?? null,
          envelope_json: JSON.stringify(envelope),
          accepted_at: acceptedAt,
        });

      const insertParent = this.db.prepare(
        'INSERT INTO causal_parents (event_id, parent_event_id, relation, is_missing) VALUES (?, ?, ?, ?)',
      );
      for (const parent of causalParents) {
        insertParent.run(
          eventId,
          parent.event_id,
          parent.relation,
          missingParentIds.includes(parent.event_id) ? 1 : 0,
        );
      }

      this.db
        .prepare(
          `INSERT INTO receipts (ledger_id, sequence, event_id, accepted_at, previous_receipt_digest, receipt_digest, signature_json)
           VALUES (@ledger_id, @sequence, @event_id, @accepted_at, @previous_receipt_digest, @receipt_digest, @signature_json)`,
        )
        .run({
          ledger_id: this.ledgerId,
          sequence,
          event_id: eventId,
          accepted_at: acceptedAt,
          previous_receipt_digest: previousReceiptDigest,
          receipt_digest: receipt.receipt_digest,
          signature_json: JSON.stringify(receipt.signature),
        });

      if (subject.artifact_id && subject.version_id) {
        this.db
          .prepare(
            `INSERT INTO heads (artifact_id, version_id, event_id, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(artifact_id) DO UPDATE SET version_id = excluded.version_id, event_id = excluded.event_id, updated_at = excluded.updated_at`,
          )
          .run(subject.artifact_id, subject.version_id, eventId, acceptedAt);
      }
    });
    txn();

    return { event: rowToStoredEvent(this.getEventRow(eventId)!), receipt, duplicate: false };
  }

  getEvent(eventId: string): StoredEvent | null {
    const row = this.getEventRow(eventId);
    return row ? rowToStoredEvent(row) : null;
  }

  getReceipt(sequence: number): LedgerReceipt | null {
    return this.getReceiptBySequence(sequence);
  }

  getHead(artifactId: string): { versionId: string; eventId: string } | null {
    const row = this.db
      .prepare('SELECT version_id, event_id FROM heads WHERE artifact_id = ?')
      .get(artifactId) as { version_id: string; event_id: string } | undefined;
    return row ? { versionId: row.version_id, eventId: row.event_id } : null;
  }

  listEvents(limit = 100, afterSequence = -1): StoredEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM events WHERE sequence > ? ORDER BY sequence ASC LIMIT ?')
      .all(afterSequence, limit) as EventRow[];
    return rows.map(rowToStoredEvent);
  }

  /** Every accepted event whose subject is the given logical artifact, oldest first -- its full version history. */
  listEventsForArtifact(artifactId: string): StoredEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM events WHERE subject_artifact_id = ? ORDER BY sequence ASC')
      .all(artifactId) as EventRow[];
    return rows.map(rowToStoredEvent);
  }

  /** Rebuilds the `heads` projection solely from the accepted event log. */
  rebuildProjections(): void {
    clearProjections(this.db);
    const rows = this.db.prepare('SELECT * FROM events ORDER BY sequence ASC').all() as EventRow[];
    const insertHead = this.db.prepare(
      `INSERT INTO heads (artifact_id, version_id, event_id, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(artifact_id) DO UPDATE SET version_id = excluded.version_id, event_id = excluded.event_id, updated_at = excluded.updated_at`,
    );
    for (const row of rows) {
      const stored = rowToStoredEvent(row);
      if (stored.subjectArtifactId && stored.subjectVersionId) {
        insertHead.run(
          stored.subjectArtifactId,
          stored.subjectVersionId,
          stored.eventId,
          stored.acceptedAt,
        );
      }
    }
  }

  /**
   * Bounded traversal of the lineage graph around `eventId`: direct and
   * transitive ancestors/descendants up to `maxDepth`, plus any missing-parent
   * boundaries encountered (ACT-1.0.md section 5.4).
   */
  getLineage(eventId: string, maxDepth = 50): LineageResult {
    const ancestors: StoredEvent[] = [];
    const boundaries: LineageBoundary[] = [];
    const seenAncestors = new Set<string>([eventId]);
    let frontier = [eventId];
    let depth = 0;
    let truncated = false;
    while (frontier.length > 0 && depth < maxDepth) {
      const nextFrontier: string[] = [];
      for (const id of frontier) {
        const parents = this.db
          .prepare('SELECT parent_event_id, is_missing FROM causal_parents WHERE event_id = ?')
          .all(id) as { parent_event_id: string; is_missing: number }[];
        for (const p of parents) {
          if (p.is_missing) {
            boundaries.push({ missingParentEventId: p.parent_event_id, referencedBy: id });
            continue;
          }
          if (seenAncestors.has(p.parent_event_id)) continue;
          seenAncestors.add(p.parent_event_id);
          const row = this.getEventRow(p.parent_event_id);
          if (row) {
            ancestors.push(rowToStoredEvent(row));
            nextFrontier.push(p.parent_event_id);
          }
        }
      }
      frontier = nextFrontier;
      depth++;
    }
    if (frontier.length > 0) truncated = true;

    const descendants: StoredEvent[] = [];
    const seenDescendants = new Set<string>([eventId]);
    frontier = [eventId];
    depth = 0;
    while (frontier.length > 0 && depth < maxDepth) {
      const nextFrontier: string[] = [];
      for (const id of frontier) {
        const children = this.db
          .prepare('SELECT event_id FROM causal_parents WHERE parent_event_id = ?')
          .all(id) as { event_id: string }[];
        for (const c of children) {
          if (seenDescendants.has(c.event_id)) continue;
          seenDescendants.add(c.event_id);
          const row = this.getEventRow(c.event_id);
          if (row) {
            descendants.push(rowToStoredEvent(row));
            nextFrontier.push(c.event_id);
          }
        }
      }
      frontier = nextFrontier;
      depth++;
    }
    if (frontier.length > 0) truncated = true;

    return { ancestors, descendants, boundaries, truncated };
  }

  quarantine(reason: string, envelope: SignedEnvelope): void {
    this.db
      .prepare(
        'INSERT INTO quarantine (id, reason, envelope_json, quarantined_at) VALUES (?, ?, ?, ?)',
      )
      .run(
        `${this.ledgerId}:${Date.parse(this.now())}:${Math.random().toString(36).slice(2)}`,
        reason,
        JSON.stringify(envelope),
        this.now(),
      );
  }

  listQuarantine(): {
    id: string;
    reason: string;
    envelope: SignedEnvelope;
    quarantinedAt: string;
  }[] {
    const rows = this.db.prepare('SELECT * FROM quarantine ORDER BY quarantined_at ASC').all() as {
      id: string;
      reason: string;
      envelope_json: string;
      quarantined_at: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      reason: r.reason,
      envelope: JSON.parse(r.envelope_json),
      quarantinedAt: r.quarantined_at,
    }));
  }

  private nextSequence(): number {
    const row = this.db
      .prepare('SELECT MAX(sequence) AS maxSeq FROM receipts WHERE ledger_id = ?')
      .get(this.ledgerId) as { maxSeq: number | null };
    return row.maxSeq === null ? 0 : row.maxSeq + 1;
  }

  private getReceiptBySequence(sequence: number): LedgerReceipt | null {
    const row = this.db
      .prepare('SELECT * FROM receipts WHERE ledger_id = ? AND sequence = ?')
      .get(this.ledgerId, sequence) as ReceiptRow | undefined;
    return row ? receiptRowToReceipt(row) : null;
  }

  private getEventRow(eventId: string): EventRow | undefined {
    return this.db.prepare('SELECT * FROM events WHERE event_id = ?').get(eventId) as
      EventRow | undefined;
  }

  private buildForwardEdgeMap(): Map<string, string[]> {
    const rows = this.db
      .prepare(
        "SELECT parent_event_id, event_id FROM causal_parents WHERE relation IN ('input','output','revision-of','merge-of') AND is_missing = 0",
      )
      .all() as { parent_event_id: string; event_id: string }[];
    const map = new Map<string, string[]>();
    for (const row of rows) {
      const list = map.get(row.parent_event_id) ?? [];
      list.push(row.event_id);
      map.set(row.parent_event_id, list);
    }
    return map;
  }
}

interface EventRow {
  event_id: string;
  ledger_id: string;
  sequence: number;
  event_type: string;
  subject_kind: string | null;
  subject_artifact_id: string | null;
  subject_version_id: string | null;
  envelope_json: string;
  accepted_at: string;
}

interface ReceiptRow {
  ledger_id: string;
  sequence: number;
  event_id: string;
  accepted_at: string;
  previous_receipt_digest: string;
  receipt_digest: string;
  signature_json: string;
}

function rowToStoredEvent(row: EventRow): StoredEvent {
  return {
    eventId: row.event_id,
    ledgerId: row.ledger_id,
    sequence: row.sequence,
    eventType: row.event_type,
    subjectKind: row.subject_kind,
    subjectArtifactId: row.subject_artifact_id,
    subjectVersionId: row.subject_version_id,
    envelope: JSON.parse(row.envelope_json),
    acceptedAt: row.accepted_at,
  };
}

function receiptRowToReceipt(row: ReceiptRow): LedgerReceipt {
  return {
    ledger_id: row.ledger_id,
    sequence: row.sequence,
    event_id: row.event_id,
    accepted_at: row.accepted_at,
    previous_receipt_digest: row.previous_receipt_digest,
    receipt_digest: row.receipt_digest,
    signature: JSON.parse(row.signature_json),
  };
}
