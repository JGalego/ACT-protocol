import { SCHEMA_IDS, canonicalize, validateAgainst } from '@act/core';
import { verifyEnvelope, type SignedEnvelope } from '@act/crypto';
import type {
  StorageAdapter,
  EventRow,
  ReceiptRow,
  CausalParentRow,
  EventQueryFilter,
} from './storage-adapter.js';
import { LINEAGE_RELATIONS, detectCycle } from './cycle.js';
import {
  detectForks,
  detectEquivocation,
  type ForkFinding,
  type EquivocationFinding,
} from './equivocation.js';
import { GENESIS_RECEIPT_DIGEST, issueReceipt, type LedgerReceipt } from './receipts.js';
import {
  ActorKeyNotSignerError,
  ArtifactExistsError,
  CycleDetectedError,
  DigestMismatchError,
  DuplicateParentError,
  IdempotencyConflictError,
  InvalidSignatureError,
  MissingParentError,
  MissingSignatureError,
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
  adapter: StorageAdapter;
  signer: LedgerSigner;
  trustPolicy: TrustPolicy;
  /** Overridable for deterministic tests; defaults to `new Date().toISOString()`. */
  now?: () => string;
}

/**
 * A hash-chained event ledger implementing the atomic write path from
 * ACT-1.0.md section 6.1, storage-neutral over any `StorageAdapter`
 * (docs/adr/0008-storage-adapter-and-postgres.md).
 */
export class Ledger {
  readonly ledgerId: string;
  private readonly adapter: StorageAdapter;
  private readonly signer: LedgerSigner;
  private readonly trustPolicy: TrustPolicy;
  private readonly now: () => string;

  constructor(options: LedgerOptions) {
    this.ledgerId = options.ledgerId;
    this.adapter = options.adapter;
    this.signer = options.signer;
    this.trustPolicy = options.trustPolicy;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /** Applies any pending schema migrations to the underlying store. Idempotent. */
  async migrate(): Promise<void> {
    await this.adapter.migrate();
  }

  /**
   * Appends a signed event, performing every step of the write path
   * atomically in a single transaction. Throws a subclass of LedgerError
   * identifying exactly which step failed.
   */
  async appendEvent(envelope: SignedEnvelope, options: AppendOptions): Promise<AppendResult> {
    // Step 1: schema and limit validation.
    const schemaResult = validateAgainst(SCHEMA_IDS.unsignedEvent, envelope.payload);
    if (!schemaResult.valid) {
      throw new SchemaValidationError(JSON.stringify(schemaResult.errors));
    }
    // An event nobody signed is not an event (spec section 5.2). The envelope
    // schema also requires this, but the ledger is callable directly, not only
    // through a schema-validating API.
    if (!Array.isArray(envelope.signatures) || envelope.signatures.length === 0) {
      throw new MissingSignatureError();
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

    // Attribution: the key the event claims as its author must be one of the
    // keys that actually signed it. Without this, any trusted key could sign
    // an event that names someone else as the actor (spec section 4.5 item 4).
    const { actor_id: actorId, key_id: actorKeyId } = (
      envelope.payload as { actor: { actor_id: string; key_id: string } }
    ).actor;
    const signerKeyIds = envelope.signatures.map((s) => s.key_id);
    if (!signerKeyIds.includes(actorKeyId)) {
      throw new ActorKeyNotSignerError(actorKeyId);
    }

    // Duplicate check (by event id): idempotent no-op returning the existing receipt.
    const duplicate = await this.existingResult(eventId);
    if (duplicate) return duplicate;

    // Idempotency key: the same key may only ever name the same event. Reusing
    // it for different content is a client bug that must not silently hand
    // back some other event's receipt.
    if (options.idempotencyKey) {
      const existingByKey = await this.adapter.findByIdempotencyKey(
        this.ledgerId,
        options.idempotencyKey,
      );
      if (existingByKey) {
        if (!isResignedRetry(existingByKey, envelope)) {
          throw new IdempotencyConflictError(options.idempotencyKey, existingByKey.event_id);
        }
        const replay = await this.existingResult(existingByKey.event_id);
        if (replay) return replay;
      }
    }

    // Step 4: evaluate trust policy -- the claimed actor/key pairing, and every
    // co-signer's key (a revoked co-signer must not lend authority).
    const bootstrap = new Set(options.additionalTrustedKeyIds ?? []);
    if (!bootstrap.has(actorKeyId) && !this.trustPolicy.isTrusted(actorId, actorKeyId)) {
      throw new UntrustedActorError(actorId, actorKeyId);
    }
    for (const keyId of new Set(signerKeyIds)) {
      if (keyId === actorKeyId || bootstrap.has(keyId)) continue;
      const trusted = this.trustPolicy.isKeyTrusted
        ? this.trustPolicy.isKeyTrusted(keyId)
        : this.trustPolicy.isTrusted('', keyId);
      if (!trusted) throw new UntrustedActorError('(co-signer)', keyId);
    }

    // Step 5: verify causal parents exist, or mark a permitted partial import.
    const causalParents = (
      (envelope.payload as { causal_parents: { event_id: string; relation?: string }[] })
        .causal_parents ?? []
    ).map((p) => ({ event_id: p.event_id, relation: p.relation ?? 'input' }));
    const seenParents = new Set<string>();
    for (const parent of causalParents) {
      if (seenParents.has(parent.event_id)) throw new DuplicateParentError(parent.event_id);
      seenParents.add(parent.event_id);
    }
    const missingParentIds: string[] = [];
    for (const parent of causalParents) {
      if (!(await this.adapter.getEvent(parent.event_id))) {
        missingParentIds.push(parent.event_id);
      }
    }
    if (missingParentIds.length > 0) {
      const permitted = options.permittedMissingParentIds
        ? new Set(options.permittedMissingParentIds)
        : options.allowPartialImport
          ? null
          : new Set<string>();
      const forbidden = permitted ? missingParentIds.filter((id) => !permitted.has(id)) : [];
      if (forbidden.length > 0) throw new MissingParentError(forbidden);
    }

    // Step 6: reject cycles (over lineage-typed relations only). Only edges
    // reachable forward from this event can close a cycle through it, so
    // load just those instead of every edge in the ledger.
    const lineageParentIds = causalParents
      .filter((p) => LINEAGE_RELATIONS.has(p.relation))
      .map((p) => p.event_id);
    const descendantEdges = await this.collectDescendantEdges(eventId);
    const cycle = detectCycle(descendantEdges, eventId, lineageParentIds);
    if (cycle) {
      throw new CycleDetectedError(cycle);
    }

    // A genesis for an artifact id someone *else* already created would be a
    // takeover of their lineage. The same actor creating a second root (e.g.
    // registering the same identity on two ledgers) is a legitimate competing
    // root: it is accepted and shows up as a second branch tip, never as a
    // silent replacement.
    const subject = envelope.payload.subject as {
      kind?: string;
      artifact_id?: string;
      version_id?: string;
    };
    if (
      envelope.payload.event_type === 'genesis' &&
      subject.kind === 'artifact' &&
      subject.artifact_id
    ) {
      const existingRoots = (await this.listEventsForArtifact(subject.artifact_id)).filter(
        (e) => e.eventType === 'genesis',
      );
      if (
        existingRoots.some(
          (e) => (e.envelope.payload as { actor: { actor_id: string } }).actor.actor_id !== actorId,
        )
      ) {
        throw new ArtifactExistsError(subject.artifact_id);
      }
    }

    // Steps 7-9: append event + receipt, update projections, all in one transaction.
    const acceptedAt = this.now();

    let receipt: LedgerReceipt;
    try {
      receipt = await this.adapter.withTransaction(async (tx) => {
        const sequence = await tx.nextSequence(this.ledgerId);
        const previousReceipt =
          sequence === 0 ? null : await tx.getReceiptBySequence(this.ledgerId, sequence - 1);
        const previousReceiptDigest =
          sequence === 0 ? GENESIS_RECEIPT_DIGEST : previousReceipt!.receipt_digest;
        const issued = issueReceipt(
          {
            ledger_id: this.ledgerId,
            sequence,
            event_id: eventId,
            accepted_at: acceptedAt,
            previous_receipt_digest: previousReceiptDigest,
          },
          this.signer,
        );

        await tx.insertEvent({
          event_id: eventId,
          ledger_id: this.ledgerId,
          sequence,
          event_type: envelope.payload.event_type as string,
          subject_kind: subject.kind ?? null,
          subject_artifact_id: subject.artifact_id ?? null,
          subject_version_id: subject.version_id ?? null,
          envelope_json: JSON.stringify(envelope),
          accepted_at: acceptedAt,
          idempotency_key: options.idempotencyKey ?? null,
        });

        for (const parent of causalParents) {
          await tx.insertCausalParent({
            event_id: eventId,
            parent_event_id: parent.event_id,
            relation: parent.relation,
            is_missing: missingParentIds.includes(parent.event_id) ? 1 : 0,
          });
        }
        // This event may be the parent that earlier partial imports were
        // missing: those boundaries are now resolved, not stale.
        await tx.resolveMissingParent(eventId);

        await tx.insertReceipt({
          ledger_id: this.ledgerId,
          sequence,
          event_id: eventId,
          accepted_at: acceptedAt,
          previous_receipt_digest: previousReceiptDigest,
          receipt_digest: issued.receipt_digest,
          signature_json: JSON.stringify(issued.signature),
          source_receipt_json: options.sourceReceipt ? JSON.stringify(options.sourceReceipt) : null,
        });

        if (subject.artifact_id && subject.version_id) {
          await tx.upsertHead({
            artifact_id: subject.artifact_id,
            version_id: subject.version_id,
            event_id: eventId,
            updated_at: acceptedAt,
          });
        }

        return issued;
      });
    } catch (err) {
      // A concurrent submission of the same event (or idempotency key) can win
      // the race between the checks above and this transaction. Resolve it the
      // same way the sequential case is resolved instead of surfacing a raw
      // constraint violation.
      const raced = await this.existingResult(eventId);
      if (raced) return raced;
      if (options.idempotencyKey) {
        const byKey = await this.adapter.findByIdempotencyKey(
          this.ledgerId,
          options.idempotencyKey,
        );
        if (byKey) throw new IdempotencyConflictError(options.idempotencyKey, byKey.event_id);
      }
      throw err;
    }

    const finalRow = await this.adapter.getEvent(eventId);
    return { event: rowToStoredEvent(finalRow!), receipt, duplicate: false };
  }

  private async existingResult(eventId: string): Promise<AppendResult | null> {
    const existing = await this.adapter.getEvent(eventId);
    if (!existing) return null;
    const receiptRow = await this.adapter.getReceiptByEventId(this.ledgerId, eventId);
    if (!receiptRow) {
      throw new Error(`Invariant violated: accepted event ${eventId} has no receipt`);
    }
    return {
      event: rowToStoredEvent(existing),
      receipt: receiptRowToReceipt(receiptRow),
      duplicate: true,
    };
  }

  /** Lineage-typed (parent -> child) edges reachable forward from `eventId`, including edges to not-yet-arrived parents. */
  private async collectDescendantEdges(eventId: string): Promise<Map<string, string[]>> {
    const edges = new Map<string, string[]>();
    const seen = new Set<string>([eventId]);
    const queue = [eventId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const children = (await this.adapter.getChildrenOf(id))
        .filter((c) => LINEAGE_RELATIONS.has(c.relation))
        .map((c) => c.event_id);
      if (children.length > 0) edges.set(id, children);
      for (const child of children) {
        if (!seen.has(child)) {
          seen.add(child);
          queue.push(child);
        }
      }
    }
    return edges;
  }

  /**
   * The version an authority policy most recently designated effective for
   * this artifact (spec section 7.3), or null. Selection events are only
   * accepted when authority-sanctioned, so the latest one is the baseline.
   */
  async getEffectiveVersion(artifactId: string): Promise<string | null> {
    const events = await this.listEventsForArtifact(artifactId);
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i]!.eventType === 'intent_effective_selected') {
        return events[i]!.subjectVersionId;
      }
    }
    return null;
  }

  /**
   * Current tip(s) of an artifact's version lineage: versions no other version
   * of the same artifact names as a lineage parent. Exactly one tip means a
   * linear history; more than one is an unresolved branch, which spec section
   * 7.3 requires to stay visible rather than be collapsed by write order.
   */
  async getTips(artifactId: string): Promise<StoredEvent[]> {
    // Only events that create an artifact *version* are tips. A transformation
    // that mentions the artifact, or a decision selecting a version as
    // effective, is something that happened to a version, not a competing one.
    const events = (await this.listEventsForArtifact(artifactId)).filter(
      (e) =>
        e.subjectKind === 'artifact' &&
        e.subjectVersionId !== null &&
        e.eventType !== 'intent_effective_selected',
    );
    const ids = new Set(events.map((e) => e.eventId));
    const referenced = new Set<string>();
    for (const e of events) {
      const parents =
        (e.envelope.payload as { causal_parents?: { event_id: string; relation?: string }[] })
          .causal_parents ?? [];
      for (const p of parents) {
        if (LINEAGE_RELATIONS.has(p.relation ?? 'input') && ids.has(p.event_id)) {
          referenced.add(p.event_id);
        }
      }
    }
    return events.filter((e) => !referenced.has(e.eventId));
  }

  async getEvent(eventId: string): Promise<StoredEvent | null> {
    const row = await this.adapter.getEvent(eventId);
    return row ? rowToStoredEvent(row) : null;
  }

  async getReceipt(sequence: number): Promise<LedgerReceipt | null> {
    const row = await this.adapter.getReceiptBySequence(this.ledgerId, sequence);
    return row ? receiptRowToReceipt(row) : null;
  }

  /** The event's own preserved source-ledger receipt, if it was imported via federation (spec/federation.md section 3). */
  async getSourceReceipt(eventId: string): Promise<LedgerReceipt | null> {
    const row = await this.adapter.getReceiptByEventId(this.ledgerId, eventId);
    if (!row?.source_receipt_json) return null;
    return JSON.parse(row.source_receipt_json) as LedgerReceipt;
  }

  async getHead(artifactId: string): Promise<{ versionId: string; eventId: string } | null> {
    const row = await this.adapter.getHead(artifactId);
    return row ? { versionId: row.version_id, eventId: row.event_id } : null;
  }

  async listEvents(limit = 100, afterSequence = -1): Promise<StoredEvent[]> {
    const rows = await this.adapter.listEvents(this.ledgerId, limit, afterSequence);
    return rows.map(rowToStoredEvent);
  }

  /** Every accepted event whose subject is the given logical artifact, oldest first -- its full version history. */
  async listEventsForArtifact(artifactId: string): Promise<StoredEvent[]> {
    const rows = await this.adapter.listEventsForArtifact(this.ledgerId, artifactId);
    return rows.map(rowToStoredEvent);
  }

  /** Like listEvents, narrowed by event_type and/or subject_kind (see EventQueryFilter). */
  async queryEvents(
    filter: EventQueryFilter,
    limit = 100,
    afterSequence = -1,
  ): Promise<StoredEvent[]> {
    const rows = await this.adapter.queryEvents(this.ledgerId, filter, limit, afterSequence);
    return rows.map(rowToStoredEvent);
  }

  /** Rebuilds the `heads` projection solely from the accepted event log. */
  async rebuildProjections(): Promise<void> {
    await this.adapter.clearProjections();
    const rows = await this.adapter.listEvents(this.ledgerId, Number.MAX_SAFE_INTEGER, -1);
    for (const row of rows) {
      const stored = rowToStoredEvent(row);
      if (stored.subjectArtifactId && stored.subjectVersionId) {
        await this.adapter.upsertHead({
          artifact_id: stored.subjectArtifactId,
          version_id: stored.subjectVersionId,
          event_id: stored.eventId,
          updated_at: stored.acceptedAt,
        });
      }
    }
  }

  /**
   * Bounded traversal of the lineage graph around `eventId`: direct and
   * transitive ancestors/descendants up to `maxDepth`, plus any missing-parent
   * boundaries encountered (ACT-1.0.md section 5.4).
   */
  async getLineage(eventId: string, maxDepth = 50): Promise<LineageResult> {
    const ancestors: StoredEvent[] = [];
    const boundaries: LineageBoundary[] = [];
    const seenAncestors = new Set<string>([eventId]);
    let frontier = [eventId];
    let depth = 0;
    let truncated = false;
    while (frontier.length > 0 && depth < maxDepth) {
      const nextFrontier: string[] = [];
      for (const id of frontier) {
        const parents = await this.adapter.getCausalParentsFor(id);
        for (const p of parents) {
          if (p.is_missing) {
            boundaries.push({ missingParentEventId: p.parent_event_id, referencedBy: id });
            continue;
          }
          if (seenAncestors.has(p.parent_event_id)) continue;
          seenAncestors.add(p.parent_event_id);
          const row = await this.adapter.getEvent(p.parent_event_id);
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
        const children = await this.adapter.getChildrenOf(id);
        for (const c of children) {
          if (seenDescendants.has(c.event_id)) continue;
          seenDescendants.add(c.event_id);
          const row = await this.adapter.getEvent(c.event_id);
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

  async quarantine(reason: string, envelope: SignedEnvelope): Promise<void> {
    await this.adapter.insertQuarantine({
      id: `${this.ledgerId}:${Date.parse(this.now())}:${Math.random().toString(36).slice(2)}`,
      reason,
      envelope_json: JSON.stringify(envelope),
      quarantined_at: this.now(),
    });
  }

  async listQuarantine(): Promise<
    { id: string; reason: string; envelope: SignedEnvelope; quarantinedAt: string }[]
  > {
    const rows = await this.adapter.listQuarantine();
    return rows.map((r) => ({
      id: r.id,
      reason: r.reason,
      envelope: JSON.parse(r.envelope_json),
      quarantinedAt: r.quarantined_at,
    }));
  }

  /** Legitimate branches: two+ accepted events naming the same lineage-typed parent (spec/federation.md section 6). Informational, not rejected. */
  async findForks(): Promise<ForkFinding[]> {
    const rows = await this.adapter.getAllCausalParents();
    return detectForks(
      rows.map((r) => ({
        parentEventId: r.parent_event_id,
        relation: r.relation,
        childEventId: r.event_id,
        isMissing: Boolean(r.is_missing),
      })),
    );
  }

  /** Adversarial: the same actor/key signing conflicting decisions over the identical subject+policy (spec/federation.md section 6). */
  async findEquivocations(): Promise<EquivocationFinding[]> {
    const events = await this.listEvents(Number.MAX_SAFE_INTEGER, -1);
    return detectEquivocation(events);
  }
}

/**
 * A retry that rebuilt and re-signed the same logical event differs from the
 * original only in its actor-claimed `occurred_at` (and therefore its event id
 * and signature). Anything else under the same idempotency key is a different
 * request.
 */
function isResignedRetry(existing: EventRow, retry: SignedEnvelope): boolean {
  try {
    const original = (JSON.parse(existing.envelope_json) as SignedEnvelope).payload;
    const stripClaimedTime = (payload: unknown) => {
      const copy = { ...(payload as Record<string, unknown>) };
      delete copy.occurred_at;
      return copy;
    };
    const originalRest = stripClaimedTime(original);
    const retryRest = stripClaimedTime(retry.payload);
    return canonicalize(originalRest) === canonicalize(retryRest);
  } catch {
    return false;
  }
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

// Re-exported so callers that only need row typing don't need to import from storage-adapter.js directly.
export type { CausalParentRow };
