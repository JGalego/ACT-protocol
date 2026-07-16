import { beforeEach, describe, expect, it } from 'vitest';
import { generateId } from '@act/core';
import { generateKeyPair } from '@act/crypto';
import { Ledger } from '../ledger.js';
import { openSqliteStore } from '../sqlite-store.js';
import { allowlistTrustPolicy } from '../types.js';
import {
  CycleDetectedError,
  DigestMismatchError,
  InvalidSignatureError,
  MissingParentError,
  SchemaValidationError,
  UntrustedActorError,
} from '../errors.js';
import { GENESIS_RECEIPT_DIGEST } from '../receipts.js';
import { buildEvent, makeActor, publicKeysFor, signedEnvelope } from './helpers.js';

function makeLedger(trustedActors: ReturnType<typeof makeActor>[]) {
  const db = openSqliteStore(':memory:');
  const ledgerKeyPair = generateKeyPair();
  const ledger = new Ledger({
    ledgerId: generateId(),
    db,
    signer: {
      keyId: ledgerKeyPair.keyId,
      publicKey: ledgerKeyPair.publicKey,
      privateKey: ledgerKeyPair.privateKey,
    },
    trustPolicy: allowlistTrustPolicy(trustedActors.map((a) => a.signer.keyId)),
  });
  return { ledger, db };
}

describe('Ledger.appendEvent', () => {
  let actor: ReturnType<typeof makeActor>;

  beforeEach(() => {
    actor = makeActor();
  });

  it('accepts a genesis event and issues sequence-0 receipt chained to the genesis constant', () => {
    const { ledger } = makeLedger([actor]);
    const artifactId = generateId();
    const envelope = signedEnvelope(
      buildEvent({
        actor,
        eventType: 'genesis',
        subject: { kind: 'artifact', artifact_id: artifactId },
      }),
      actor,
    );
    const result = ledger.appendEvent(envelope, { publicKeys: publicKeysFor(actor) });
    expect(result.duplicate).toBe(false);
    expect(result.receipt.sequence).toBe(0);
    expect(result.receipt.previous_receipt_digest).toBe(GENESIS_RECEIPT_DIGEST);
    expect(result.event.eventId).toBe(envelope.payloadDigest);
  });

  it('chains a second event to the first receipt', () => {
    const { ledger } = makeLedger([actor]);
    const artifactId = generateId();
    const genesis = signedEnvelope(
      buildEvent({
        actor,
        eventType: 'genesis',
        subject: { kind: 'artifact', artifact_id: artifactId },
      }),
      actor,
    );
    const first = ledger.appendEvent(genesis, { publicKeys: publicKeysFor(actor) });

    const second = signedEnvelope(
      buildEvent({
        actor,
        eventType: 'artifact_revised',
        subject: { kind: 'artifact', artifact_id: artifactId },
        causalParents: [{ event_id: first.event.eventId, relation: 'revision-of' }],
      }),
      actor,
    );
    const result = ledger.appendEvent(second, { publicKeys: publicKeysFor(actor) });
    expect(result.receipt.sequence).toBe(1);
    expect(result.receipt.previous_receipt_digest).toBe(first.receipt.receipt_digest);
  });

  it('is idempotent for duplicate event submission (returns the existing receipt, no new one)', () => {
    const { ledger } = makeLedger([actor]);
    const envelope = signedEnvelope(
      buildEvent({
        actor,
        eventType: 'genesis',
        subject: { kind: 'artifact', artifact_id: generateId() },
      }),
      actor,
    );
    const first = ledger.appendEvent(envelope, { publicKeys: publicKeysFor(actor) });
    const second = ledger.appendEvent(envelope, { publicKeys: publicKeysFor(actor) });
    expect(second.duplicate).toBe(true);
    expect(second.receipt.sequence).toBe(first.receipt.sequence);
    expect(second.receipt.receipt_digest).toBe(first.receipt.receipt_digest);
  });

  it('rejects an event with a missing causal parent by default', () => {
    const { ledger } = makeLedger([actor]);
    const envelope = signedEnvelope(
      buildEvent({
        actor,
        eventType: 'transformation_recorded',
        subject: { kind: 'transformation' },
        causalParents: [{ event_id: `sha-256:${'9'.repeat(64)}` }],
      }),
      actor,
    );
    expect(() => ledger.appendEvent(envelope, { publicKeys: publicKeysFor(actor) })).toThrow(
      MissingParentError,
    );
  });

  it('accepts a missing-parent event when allowPartialImport is set, recording a lineage boundary', () => {
    const { ledger } = makeLedger([actor]);
    const missingParentId = `sha-256:${'9'.repeat(64)}`;
    const envelope = signedEnvelope(
      buildEvent({
        actor,
        eventType: 'external_import',
        subject: { kind: 'artifact', artifact_id: generateId() },
        causalParents: [{ event_id: missingParentId }],
      }),
      actor,
    );
    const result = ledger.appendEvent(envelope, {
      publicKeys: publicKeysFor(actor),
      allowPartialImport: true,
    });
    const lineage = ledger.getLineage(result.event.eventId);
    expect(lineage.boundaries).toEqual([
      { missingParentEventId: missingParentId, referencedBy: result.event.eventId },
    ]);
  });

  it('rejects an untrusted actor', () => {
    const trusted = makeActor();
    const untrusted = makeActor();
    const { ledger } = makeLedger([trusted]);
    const envelope = signedEnvelope(
      buildEvent({
        actor: untrusted,
        eventType: 'genesis',
        subject: { kind: 'artifact', artifact_id: generateId() },
      }),
      untrusted,
    );
    expect(() => ledger.appendEvent(envelope, { publicKeys: publicKeysFor(untrusted) })).toThrow(
      UntrustedActorError,
    );
  });

  it('rejects a corrupted signature', () => {
    const { ledger } = makeLedger([actor]);
    const envelope = signedEnvelope(
      buildEvent({
        actor,
        eventType: 'genesis',
        subject: { kind: 'artifact', artifact_id: generateId() },
      }),
      actor,
    );
    envelope.signatures[0]!.signature = Buffer.from('corrupted-signature-bytes').toString('base64');
    expect(() => ledger.appendEvent(envelope, { publicKeys: publicKeysFor(actor) })).toThrow(
      InvalidSignatureError,
    );
  });

  it('rejects a tampered payload whose digest no longer matches payloadDigest', () => {
    const { ledger } = makeLedger([actor]);
    const envelope = signedEnvelope(
      buildEvent({
        actor,
        eventType: 'genesis',
        subject: { kind: 'artifact', artifact_id: generateId() },
      }),
      actor,
    );
    envelope.payload.occurred_at = '2099-01-01T00:00:00Z';
    expect(() => ledger.appendEvent(envelope, { publicKeys: publicKeysFor(actor) })).toThrow(
      DigestMismatchError,
    );
  });

  it('rejects a schema-invalid event (non-genesis with empty causal_parents)', () => {
    const { ledger } = makeLedger([actor]);
    const payload = buildEvent({
      actor,
      eventType: 'transformation_recorded',
      subject: { kind: 'transformation' },
    });
    const envelope = signedEnvelope(payload, actor);
    expect(() => ledger.appendEvent(envelope, { publicKeys: publicKeysFor(actor) })).toThrow(
      SchemaValidationError,
    );
  });

  it('tracks the current head for an artifact and updates it on revision', () => {
    const { ledger } = makeLedger([actor]);
    const artifactId = generateId();
    const v1 = 'sha-256:' + '1'.repeat(64);
    const v2 = 'sha-256:' + '2'.repeat(64);
    const genesis = ledger.appendEvent(
      signedEnvelope(
        buildEvent({
          actor,
          eventType: 'genesis',
          subject: { kind: 'artifact', artifact_id: artifactId, version_id: v1 },
        }),
        actor,
      ),
      { publicKeys: publicKeysFor(actor) },
    );
    expect(ledger.getHead(artifactId)).toEqual({ versionId: v1, eventId: genesis.event.eventId });

    const revision = ledger.appendEvent(
      signedEnvelope(
        buildEvent({
          actor,
          eventType: 'artifact_revised',
          subject: { kind: 'artifact', artifact_id: artifactId, version_id: v2 },
          causalParents: [{ event_id: genesis.event.eventId, relation: 'revision-of' }],
        }),
        actor,
      ),
      { publicKeys: publicKeysFor(actor) },
    );
    expect(ledger.getHead(artifactId)).toEqual({ versionId: v2, eventId: revision.event.eventId });
  });

  it('rebuildProjections reproduces the same heads solely from the event log', () => {
    const { ledger } = makeLedger([actor]);
    const artifactId = generateId();
    const v1 = 'sha-256:' + '3'.repeat(64);
    ledger.appendEvent(
      signedEnvelope(
        buildEvent({
          actor,
          eventType: 'genesis',
          subject: { kind: 'artifact', artifact_id: artifactId, version_id: v1 },
        }),
        actor,
      ),
      { publicKeys: publicKeysFor(actor) },
    );
    const before = ledger.getHead(artifactId);
    ledger.rebuildProjections();
    const after = ledger.getHead(artifactId);
    expect(after).toEqual(before);
  });

  it('supports a two-input transformation producing a valid DAG traversable via getLineage', () => {
    const { ledger } = makeLedger([actor]);
    const inputA = ledger.appendEvent(
      signedEnvelope(
        buildEvent({
          actor,
          eventType: 'genesis',
          subject: { kind: 'artifact', artifact_id: generateId() },
        }),
        actor,
      ),
      { publicKeys: publicKeysFor(actor) },
    );
    const inputB = ledger.appendEvent(
      signedEnvelope(
        buildEvent({
          actor,
          eventType: 'genesis',
          subject: { kind: 'artifact', artifact_id: generateId() },
        }),
        actor,
      ),
      { publicKeys: publicKeysFor(actor) },
    );
    const merge = ledger.appendEvent(
      signedEnvelope(
        buildEvent({
          actor,
          eventType: 'transformation_recorded',
          subject: { kind: 'transformation' },
          causalParents: [
            { event_id: inputA.event.eventId, relation: 'input' },
            { event_id: inputB.event.eventId, relation: 'input' },
          ],
        }),
        actor,
      ),
      { publicKeys: publicKeysFor(actor) },
    );
    const lineage = ledger.getLineage(merge.event.eventId);
    const ancestorIds = lineage.ancestors.map((e) => e.eventId).sort();
    expect(ancestorIds).toEqual([inputA.event.eventId, inputB.event.eventId].sort());
    expect(lineage.boundaries).toEqual([]);

    const forwardLineage = ledger.getLineage(inputA.event.eventId);
    expect(forwardLineage.descendants.map((e) => e.eventId)).toEqual([merge.event.eventId]);
  });

  it('getReceipt looks up a receipt by sequence number', () => {
    const { ledger } = makeLedger([actor]);
    const result = ledger.appendEvent(
      signedEnvelope(
        buildEvent({
          actor,
          eventType: 'genesis',
          subject: { kind: 'artifact', artifact_id: generateId() },
        }),
        actor,
      ),
      { publicKeys: publicKeysFor(actor) },
    );
    expect(ledger.getReceipt(0)).toEqual(result.receipt);
    expect(ledger.getReceipt(99)).toBeNull();
  });

  it('getEvent returns null for an unknown event id', () => {
    const { ledger } = makeLedger([actor]);
    expect(ledger.getEvent(`sha-256:${'0'.repeat(64)}`)).toBeNull();
  });

  it('records and lists quarantined envelopes without affecting accepted history', () => {
    const { ledger } = makeLedger([actor]);
    const badEnvelope = signedEnvelope(
      buildEvent({
        actor,
        eventType: 'genesis',
        subject: { kind: 'artifact', artifact_id: generateId() },
      }),
      actor,
    );
    ledger.quarantine('untrusted source ledger', badEnvelope);
    const quarantined = ledger.listQuarantine();
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]!.reason).toBe('untrusted source ledger');
    expect(quarantined[0]!.envelope.payloadDigest).toBe(badEnvelope.payloadDigest);
    expect(ledger.listEvents()).toHaveLength(0);
  });

  it('rejects an event that would introduce a lineage cycle', () => {
    // Cycle detection is a no-op for ordinary sequential single-ledger
    // appends (an event's parents are always already-accepted, immutable
    // events, so a genuine cycle cannot arise that way -- see cycle.ts).
    // It earns its keep once a batch of not-yet-validated events is
    // considered together, e.g. during a future federation import. This
    // test exercises that wiring directly by pre-registering a forward
    // edge that closes a loop, the same shape a corrupted or malicious
    // import batch would produce.
    const { ledger, db } = makeLedger([actor]);
    const existing = ledger.appendEvent(
      signedEnvelope(
        buildEvent({
          actor,
          eventType: 'genesis',
          subject: { kind: 'artifact', artifact_id: generateId() },
        }),
        actor,
      ),
      { publicKeys: publicKeysFor(actor) },
    );
    const nextEnvelope = signedEnvelope(
      buildEvent({
        actor,
        eventType: 'transformation_recorded',
        subject: { kind: 'transformation' },
        causalParents: [{ event_id: existing.event.eventId, relation: 'input' }],
      }),
      actor,
    );
    const nextEventId = nextEnvelope.payloadDigest;
    // Simulate a pre-existing forward edge nextEventId -> existing.event.eventId,
    // i.e. "existing" already (tentatively) cites the about-to-be-appended
    // event as its own parent.
    db.prepare(
      'INSERT INTO causal_parents (event_id, parent_event_id, relation, is_missing) VALUES (?, ?, ?, 0)',
    ).run(existing.event.eventId, nextEventId, 'input');
    expect(() => ledger.appendEvent(nextEnvelope, { publicKeys: publicKeysFor(actor) })).toThrow(
      CycleDetectedError,
    );
  });
});
