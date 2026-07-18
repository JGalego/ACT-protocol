import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateId } from '@act/core';
import { generateKeyPair } from '@act/crypto';
import { Ledger } from '../../ledger.js';
import type { StorageAdapter } from '../../storage-adapter.js';
import { allowlistTrustPolicy } from '../../types.js';
import {
  CycleDetectedError,
  DigestMismatchError,
  InvalidSignatureError,
  MissingParentError,
  SchemaValidationError,
  UntrustedActorError,
} from '../../errors.js';
import { GENESIS_RECEIPT_DIGEST } from '../../receipts.js';
import { buildEvent, makeActor, publicKeysFor, signedEnvelope } from '../helpers.js';

/**
 * The full `Ledger.appendEvent` behavioral contract, expressed once and run
 * against any `StorageAdapter` -- this is what proves SQLite and PostgreSQL
 * are "behaviorally equivalent" (PROMPT.md) rather than merely
 * independently plausible.
 */
export function registerLedgerSuite(
  dialectName: string,
  makeAdapter: () => Promise<StorageAdapter>,
  cleanupAdapter?: (adapter: StorageAdapter) => Promise<void>,
): void {
  async function makeLedger(trustedActors: ReturnType<typeof makeActor>[]) {
    const adapter = await makeAdapter();
    const ledgerKeyPair = generateKeyPair();
    const ledger = new Ledger({
      ledgerId: generateId(),
      adapter,
      signer: {
        keyId: ledgerKeyPair.keyId,
        publicKey: ledgerKeyPair.publicKey,
        privateKey: ledgerKeyPair.privateKey,
      },
      trustPolicy: allowlistTrustPolicy(trustedActors.map((a) => a.signer.keyId)),
    });
    return { ledger, adapter };
  }

  describe(`Ledger.appendEvent [${dialectName}]`, () => {
    let actor: ReturnType<typeof makeActor>;
    let activeAdapter: StorageAdapter | undefined;

    beforeEach(() => {
      actor = makeActor();
      activeAdapter = undefined;
    });

    if (cleanupAdapter) {
      afterEach(async () => {
        if (activeAdapter) await cleanupAdapter(activeAdapter);
      });
    }

    async function setup(trustedActors: ReturnType<typeof makeActor>[]) {
      const { ledger, adapter } = await makeLedger(trustedActors);
      activeAdapter = adapter;
      return { ledger, adapter };
    }

    it('accepts a genesis event and issues sequence-0 receipt chained to the genesis constant', async () => {
      const { ledger } = await setup([actor]);
      const artifactId = generateId();
      const envelope = signedEnvelope(
        buildEvent({
          actor,
          eventType: 'genesis',
          subject: { kind: 'artifact', artifact_id: artifactId },
        }),
        actor,
      );
      const result = await ledger.appendEvent(envelope, { publicKeys: publicKeysFor(actor) });
      expect(result.duplicate).toBe(false);
      expect(result.receipt.sequence).toBe(0);
      expect(result.receipt.previous_receipt_digest).toBe(GENESIS_RECEIPT_DIGEST);
      expect(result.event.eventId).toBe(envelope.payloadDigest);
    });

    it('chains a second event to the first receipt', async () => {
      const { ledger } = await setup([actor]);
      const artifactId = generateId();
      const genesis = signedEnvelope(
        buildEvent({
          actor,
          eventType: 'genesis',
          subject: { kind: 'artifact', artifact_id: artifactId },
        }),
        actor,
      );
      const first = await ledger.appendEvent(genesis, { publicKeys: publicKeysFor(actor) });

      const second = signedEnvelope(
        buildEvent({
          actor,
          eventType: 'artifact_revised',
          subject: { kind: 'artifact', artifact_id: artifactId },
          causalParents: [{ event_id: first.event.eventId, relation: 'revision-of' }],
        }),
        actor,
      );
      const result = await ledger.appendEvent(second, { publicKeys: publicKeysFor(actor) });
      expect(result.receipt.sequence).toBe(1);
      expect(result.receipt.previous_receipt_digest).toBe(first.receipt.receipt_digest);
    });

    it('is idempotent for duplicate event submission (returns the existing receipt, no new one)', async () => {
      const { ledger } = await setup([actor]);
      const envelope = signedEnvelope(
        buildEvent({
          actor,
          eventType: 'genesis',
          subject: { kind: 'artifact', artifact_id: generateId() },
        }),
        actor,
      );
      const first = await ledger.appendEvent(envelope, { publicKeys: publicKeysFor(actor) });
      const second = await ledger.appendEvent(envelope, { publicKeys: publicKeysFor(actor) });
      expect(second.duplicate).toBe(true);
      expect(second.receipt.sequence).toBe(first.receipt.sequence);
      expect(second.receipt.receipt_digest).toBe(first.receipt.receipt_digest);
    });

    it('is idempotent via an explicit idempotency key, independent of event content', async () => {
      const { ledger } = await setup([actor]);
      const key = `idem-${generateId()}`;
      const envelope1 = signedEnvelope(
        buildEvent({
          actor,
          eventType: 'genesis',
          subject: { kind: 'artifact', artifact_id: generateId() },
        }),
        actor,
      );
      const first = await ledger.appendEvent(envelope1, {
        publicKeys: publicKeysFor(actor),
        idempotencyKey: key,
      });
      const envelope2 = signedEnvelope(
        buildEvent({
          actor,
          eventType: 'genesis',
          subject: { kind: 'artifact', artifact_id: generateId() },
          occurredAt: '2026-07-17T00:00:00Z',
        }),
        actor,
      );
      const second = await ledger.appendEvent(envelope2, {
        publicKeys: publicKeysFor(actor),
        idempotencyKey: key,
      });
      expect(second.duplicate).toBe(true);
      expect(second.event.eventId).toBe(first.event.eventId);
    });

    it('rejects an event with a missing causal parent by default', async () => {
      const { ledger } = await setup([actor]);
      const envelope = signedEnvelope(
        buildEvent({
          actor,
          eventType: 'transformation_recorded',
          subject: { kind: 'transformation' },
          causalParents: [{ event_id: `sha-256:${'9'.repeat(64)}` }],
        }),
        actor,
      );
      await expect(
        ledger.appendEvent(envelope, { publicKeys: publicKeysFor(actor) }),
      ).rejects.toThrow(MissingParentError);
    });

    it('accepts a missing-parent event when allowPartialImport is set, recording a lineage boundary', async () => {
      const { ledger } = await setup([actor]);
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
      const result = await ledger.appendEvent(envelope, {
        publicKeys: publicKeysFor(actor),
        allowPartialImport: true,
      });
      const lineage = await ledger.getLineage(result.event.eventId);
      expect(lineage.boundaries).toEqual([
        { missingParentEventId: missingParentId, referencedBy: result.event.eventId },
      ]);
    });

    it('rejects an untrusted actor', async () => {
      const trusted = makeActor();
      const untrusted = makeActor();
      const { ledger } = await setup([trusted]);
      const envelope = signedEnvelope(
        buildEvent({
          actor: untrusted,
          eventType: 'genesis',
          subject: { kind: 'artifact', artifact_id: generateId() },
        }),
        untrusted,
      );
      await expect(
        ledger.appendEvent(envelope, { publicKeys: publicKeysFor(untrusted) }),
      ).rejects.toThrow(UntrustedActorError);
    });

    it('rejects a corrupted signature', async () => {
      const { ledger } = await setup([actor]);
      const envelope = signedEnvelope(
        buildEvent({
          actor,
          eventType: 'genesis',
          subject: { kind: 'artifact', artifact_id: generateId() },
        }),
        actor,
      );
      envelope.signatures[0]!.signature = Buffer.from('corrupted-signature-bytes').toString(
        'base64',
      );
      await expect(
        ledger.appendEvent(envelope, { publicKeys: publicKeysFor(actor) }),
      ).rejects.toThrow(InvalidSignatureError);
    });

    it('rejects a tampered payload whose digest no longer matches payloadDigest', async () => {
      const { ledger } = await setup([actor]);
      const envelope = signedEnvelope(
        buildEvent({
          actor,
          eventType: 'genesis',
          subject: { kind: 'artifact', artifact_id: generateId() },
        }),
        actor,
      );
      envelope.payload.occurred_at = '2099-01-01T00:00:00Z';
      await expect(
        ledger.appendEvent(envelope, { publicKeys: publicKeysFor(actor) }),
      ).rejects.toThrow(DigestMismatchError);
    });

    it('rejects a schema-invalid event (non-genesis with empty causal_parents)', async () => {
      const { ledger } = await setup([actor]);
      const payload = buildEvent({
        actor,
        eventType: 'transformation_recorded',
        subject: { kind: 'transformation' },
      });
      const envelope = signedEnvelope(payload, actor);
      await expect(
        ledger.appendEvent(envelope, { publicKeys: publicKeysFor(actor) }),
      ).rejects.toThrow(SchemaValidationError);
    });

    it('tracks the current head for an artifact and updates it on revision', async () => {
      const { ledger } = await setup([actor]);
      const artifactId = generateId();
      const v1 = 'sha-256:' + '1'.repeat(64);
      const v2 = 'sha-256:' + '2'.repeat(64);
      const genesis = await ledger.appendEvent(
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
      expect(await ledger.getHead(artifactId)).toEqual({
        versionId: v1,
        eventId: genesis.event.eventId,
      });

      const revision = await ledger.appendEvent(
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
      expect(await ledger.getHead(artifactId)).toEqual({
        versionId: v2,
        eventId: revision.event.eventId,
      });
    });

    it('rebuildProjections reproduces the same heads solely from the event log', async () => {
      const { ledger } = await setup([actor]);
      const artifactId = generateId();
      const v1 = 'sha-256:' + '3'.repeat(64);
      await ledger.appendEvent(
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
      const before = await ledger.getHead(artifactId);
      await ledger.rebuildProjections();
      const after = await ledger.getHead(artifactId);
      expect(after).toEqual(before);
    });

    it('supports a two-input transformation producing a valid DAG traversable via getLineage', async () => {
      const { ledger } = await setup([actor]);
      const inputA = await ledger.appendEvent(
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
      const inputB = await ledger.appendEvent(
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
      const merge = await ledger.appendEvent(
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
      const lineage = await ledger.getLineage(merge.event.eventId);
      const ancestorIds = lineage.ancestors.map((e) => e.eventId).sort();
      expect(ancestorIds).toEqual([inputA.event.eventId, inputB.event.eventId].sort());
      expect(lineage.boundaries).toEqual([]);

      const forwardLineage = await ledger.getLineage(inputA.event.eventId);
      expect(forwardLineage.descendants.map((e) => e.eventId)).toEqual([merge.event.eventId]);
    });

    it('getReceipt looks up a receipt by sequence number', async () => {
      const { ledger } = await setup([actor]);
      const result = await ledger.appendEvent(
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
      expect(await ledger.getReceipt(0)).toEqual(result.receipt);
      expect(await ledger.getReceipt(99)).toBeNull();
    });

    it('listEventsForArtifact returns the full version history of one logical artifact, oldest first', async () => {
      const { ledger } = await setup([actor]);
      const artifactId = generateId();
      const otherArtifactId = generateId();
      const v1 = await ledger.appendEvent(
        signedEnvelope(
          buildEvent({
            actor,
            eventType: 'genesis',
            subject: {
              kind: 'artifact',
              artifact_id: artifactId,
              version_id: 'sha-256:' + '4'.repeat(64),
            },
          }),
          actor,
        ),
        { publicKeys: publicKeysFor(actor) },
      );
      await ledger.appendEvent(
        signedEnvelope(
          buildEvent({
            actor,
            eventType: 'genesis',
            subject: { kind: 'artifact', artifact_id: otherArtifactId },
          }),
          actor,
        ),
        { publicKeys: publicKeysFor(actor) },
      );
      const v2 = await ledger.appendEvent(
        signedEnvelope(
          buildEvent({
            actor,
            eventType: 'artifact_revised',
            subject: {
              kind: 'artifact',
              artifact_id: artifactId,
              version_id: 'sha-256:' + '5'.repeat(64),
            },
            causalParents: [{ event_id: v1.event.eventId, relation: 'revision-of' }],
          }),
          actor,
        ),
        { publicKeys: publicKeysFor(actor) },
      );
      const history = await ledger.listEventsForArtifact(artifactId);
      expect(history.map((e) => e.eventId)).toEqual([v1.event.eventId, v2.event.eventId]);
    });

    it('queryEvents filters by event_type and by subject_kind independently', async () => {
      const { ledger } = await setup([actor]);
      const genesisResult = await ledger.appendEvent(
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
      const challengeResult = await ledger.appendEvent(
        signedEnvelope(
          buildEvent({
            actor,
            eventType: 'challenge_raised',
            subject: { kind: 'attestation', artifact_id: generateId() },
            causalParents: [{ event_id: genesisResult.event.eventId, relation: 'response-to' }],
          }),
          actor,
        ),
        { publicKeys: publicKeysFor(actor) },
      );

      const byType = await ledger.queryEvents({ eventTypes: ['challenge_raised'] });
      expect(byType.map((e) => e.eventId)).toEqual([challengeResult.event.eventId]);

      const byMultipleTypes = await ledger.queryEvents({
        eventTypes: ['genesis', 'challenge_raised'],
      });
      expect(new Set(byMultipleTypes.map((e) => e.eventId))).toEqual(
        new Set([genesisResult.event.eventId, challengeResult.event.eventId]),
      );

      const bySubjectKind = await ledger.queryEvents({ subjectKind: 'artifact' });
      expect(bySubjectKind.map((e) => e.eventId)).toEqual([genesisResult.event.eventId]);

      const byBoth = await ledger.queryEvents({
        eventTypes: ['challenge_raised'],
        subjectKind: 'artifact',
      });
      expect(byBoth).toEqual([]);

      const unfiltered = await ledger.queryEvents({});
      expect(unfiltered.map((e) => e.eventId).sort()).toEqual(
        [genesisResult.event.eventId, challengeResult.event.eventId].sort(),
      );
    });

    it('getEvent returns null for an unknown event id', async () => {
      const { ledger } = await setup([actor]);
      expect(await ledger.getEvent(`sha-256:${'0'.repeat(64)}`)).toBeNull();
    });

    it('records and lists quarantined envelopes without affecting accepted history', async () => {
      const { ledger } = await setup([actor]);
      const badEnvelope = signedEnvelope(
        buildEvent({
          actor,
          eventType: 'genesis',
          subject: { kind: 'artifact', artifact_id: generateId() },
        }),
        actor,
      );
      await ledger.quarantine('untrusted source ledger', badEnvelope);
      const quarantined = await ledger.listQuarantine();
      expect(quarantined).toHaveLength(1);
      expect(quarantined[0]!.reason).toBe('untrusted source ledger');
      expect(quarantined[0]!.envelope.payloadDigest).toBe(badEnvelope.payloadDigest);
      expect(await ledger.listEvents()).toHaveLength(0);
    });

    it('preserves a federation source receipt when one is supplied', async () => {
      const { ledger } = await setup([actor]);
      const envelope = signedEnvelope(
        buildEvent({
          actor,
          eventType: 'genesis',
          subject: { kind: 'artifact', artifact_id: generateId() },
        }),
        actor,
      );
      const sourceReceipt = {
        ledger_id: 'some-other-ledger',
        sequence: 7,
        event_id: envelope.payloadDigest,
        accepted_at: '2026-01-01T00:00:00Z',
        previous_receipt_digest: GENESIS_RECEIPT_DIGEST,
        receipt_digest: `sha-256:${'a'.repeat(64)}`,
        signature: { key_id: 'k1', algorithm: 'ed25519' as const, signature: 'zzz' },
      };
      const result = await ledger.appendEvent(envelope, {
        publicKeys: publicKeysFor(actor),
        allowPartialImport: true,
        sourceReceipt,
      });
      expect(result.receipt.sequence).toBe(0); // this ledger's own sequence, independent of the source's
      const preserved = await ledger.getSourceReceipt(result.event.eventId);
      expect(preserved).toEqual(sourceReceipt);
    });

    it('rejects an event that would introduce a lineage cycle', async () => {
      // Cycle detection is a no-op for ordinary sequential single-ledger
      // appends (an event's parents are always already-accepted, immutable
      // events, so a genuine cycle cannot arise that way -- see cycle.ts).
      // It earns its keep once a batch of not-yet-validated events is
      // considered together, e.g. during a federation import. This test
      // exercises that wiring directly by pre-registering a forward edge
      // that closes a loop, the same shape a corrupted or malicious import
      // batch would produce.
      const { ledger, adapter } = await setup([actor]);
      const existing = await ledger.appendEvent(
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
      await adapter.withTransaction(async (tx) => {
        await tx.insertCausalParent({
          event_id: existing.event.eventId,
          parent_event_id: nextEventId,
          relation: 'input',
          is_missing: 0,
        });
      });
      await expect(
        ledger.appendEvent(nextEnvelope, { publicKeys: publicKeysFor(actor) }),
      ).rejects.toThrow(CycleDetectedError);
    });
  });
}
