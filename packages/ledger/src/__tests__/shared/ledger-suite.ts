import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateId } from '@act/core';
import { generateKeyPair, signEnvelope } from '@act/crypto';
import { Ledger } from '../../ledger.js';
import type { StorageAdapter } from '../../storage-adapter.js';
import { allowlistTrustPolicy } from '../../types.js';
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

    it('treats a re-signed retry under the same idempotency key as a replay', async () => {
      const { ledger } = await setup([actor]);
      const key = `idem-${generateId()}`;
      const artifactId = generateId();
      const build = (occurredAt: string) =>
        signedEnvelope(
          buildEvent({
            actor,
            eventType: 'genesis',
            subject: { kind: 'artifact', artifact_id: artifactId },
            occurredAt,
          }),
          actor,
        );
      const first = await ledger.appendEvent(build('2026-07-16T00:00:00Z'), {
        publicKeys: publicKeysFor(actor),
        idempotencyKey: key,
      });
      const second = await ledger.appendEvent(build('2026-07-17T00:00:00Z'), {
        publicKeys: publicKeysFor(actor),
        idempotencyKey: key,
      });
      expect(second.duplicate).toBe(true);
      expect(second.event.eventId).toBe(first.event.eventId);
    });

    it('rejects an idempotency key reused for a substantively different event', async () => {
      const { ledger } = await setup([actor]);
      const key = `idem-${generateId()}`;
      const build = () =>
        signedEnvelope(
          buildEvent({
            actor,
            eventType: 'genesis',
            subject: { kind: 'artifact', artifact_id: generateId() },
          }),
          actor,
        );
      await ledger.appendEvent(build(), { publicKeys: publicKeysFor(actor), idempotencyKey: key });
      const different = build();
      await expect(
        ledger.appendEvent(different, { publicKeys: publicKeysFor(actor), idempotencyKey: key }),
      ).rejects.toBeInstanceOf(IdempotencyConflictError);
      expect(await ledger.getEvent(different.payloadDigest)).toBeNull();
    });

    it('rejects an event whose claimed actor key is not among its signers (impersonation)', async () => {
      const mallory = makeActor();
      const { ledger } = await setup([actor, mallory]);
      // Event names `actor` as its author but is signed only by `mallory`.
      const forged = signedEnvelope(
        buildEvent({
          actor,
          eventType: 'genesis',
          subject: { kind: 'artifact', artifact_id: generateId() },
        }),
        mallory,
      );
      await expect(
        ledger.appendEvent(forged, { publicKeys: publicKeysFor(actor, mallory) }),
      ).rejects.toBeInstanceOf(ActorKeyNotSignerError);
    });

    it('rejects an event with no signatures at all', async () => {
      const { ledger } = await setup([actor]);
      const unsigned = {
        ...signedEnvelope(
          buildEvent({
            actor,
            eventType: 'genesis',
            subject: { kind: 'artifact', artifact_id: generateId() },
          }),
          actor,
        ),
        signatures: [],
      };
      await expect(
        ledger.appendEvent(unsigned, { publicKeys: publicKeysFor(actor) }),
      ).rejects.toBeInstanceOf(MissingSignatureError);
    });

    it('rejects an event co-signed by an untrusted key', async () => {
      const stranger = makeActor();
      const { ledger } = await setup([actor]);
      const envelope = signEnvelope(
        buildEvent({
          actor,
          eventType: 'genesis',
          subject: { kind: 'artifact', artifact_id: generateId() },
        }),
        [actor.signer, stranger.signer],
      );
      await expect(
        ledger.appendEvent(envelope, { publicKeys: publicKeysFor(actor, stranger) }),
      ).rejects.toBeInstanceOf(UntrustedActorError);
    });

    it('rejects a genesis by a different actor for an artifact id that already exists', async () => {
      const mallory = makeActor();
      const { ledger } = await setup([actor, mallory]);
      const artifactId = generateId();
      const genesis = (who: typeof actor, versionId: string) =>
        signedEnvelope(
          buildEvent({
            actor: who,
            eventType: 'genesis',
            subject: { kind: 'artifact', artifact_id: artifactId, version_id: versionId },
          }),
          who,
        );
      await ledger.appendEvent(genesis(actor, `sha-256:${'1'.repeat(64)}`), {
        publicKeys: publicKeysFor(actor, mallory),
      });
      await expect(
        ledger.appendEvent(genesis(mallory, `sha-256:${'2'.repeat(64)}`), {
          publicKeys: publicKeysFor(actor, mallory),
        }),
      ).rejects.toBeInstanceOf(ArtifactExistsError);
      expect((await ledger.getHead(artifactId))?.versionId).toBe(`sha-256:${'1'.repeat(64)}`);
    });

    it('lets the same actor record a second genesis, which surfaces as a second tip', async () => {
      const { ledger } = await setup([actor]);
      const artifactId = generateId();
      const genesis = (versionId: string) =>
        signedEnvelope(
          buildEvent({
            actor,
            eventType: 'genesis',
            subject: { kind: 'artifact', artifact_id: artifactId, version_id: versionId },
          }),
          actor,
        );
      await ledger.appendEvent(genesis(`sha-256:${'1'.repeat(64)}`), {
        publicKeys: publicKeysFor(actor),
      });
      await ledger.appendEvent(genesis(`sha-256:${'2'.repeat(64)}`), {
        publicKeys: publicKeysFor(actor),
      });
      expect(await ledger.getTips(artifactId)).toHaveLength(2);
    });

    it('rejects a parent listed twice instead of surfacing a database error', async () => {
      const { ledger } = await setup([actor]);
      const parent = await ledger.appendEvent(
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
      const child = signedEnvelope(
        buildEvent({
          actor,
          eventType: 'transformation_recorded',
          subject: { kind: 'transformation' },
          causalParents: [
            { event_id: parent.event.eventId, relation: 'input' },
            { event_id: parent.event.eventId, relation: 'revision-of' },
          ],
        }),
        actor,
      );
      await expect(
        ledger.appendEvent(child, { publicKeys: publicKeysFor(actor) }),
      ).rejects.toBeInstanceOf(DuplicateParentError);
    });

    it('clears a missing-parent boundary once the parent is backfilled', async () => {
      const { ledger } = await setup([actor]);
      const artifactId = generateId();
      const parentEnv = signedEnvelope(
        buildEvent({
          actor,
          eventType: 'genesis',
          subject: { kind: 'artifact', artifact_id: artifactId },
        }),
        actor,
      );
      const childEnv = signedEnvelope(
        buildEvent({
          actor,
          eventType: 'artifact_revised',
          subject: { kind: 'artifact', artifact_id: artifactId },
          causalParents: [{ event_id: parentEnv.payloadDigest, relation: 'revision-of' }],
        }),
        actor,
      );
      await ledger.appendEvent(childEnv, {
        publicKeys: publicKeysFor(actor),
        allowPartialImport: true,
      });
      expect((await ledger.getLineage(childEnv.payloadDigest)).boundaries).toHaveLength(1);
      await ledger.appendEvent(parentEnv, { publicKeys: publicKeysFor(actor) });
      const lineage = await ledger.getLineage(childEnv.payloadDigest);
      expect(lineage.boundaries).toHaveLength(0);
      expect(lineage.ancestors.map((e) => e.eventId)).toEqual([parentEnv.payloadDigest]);
    });

    it('only tolerates missing parents that the caller explicitly permitted', async () => {
      const { ledger } = await setup([actor]);
      const declared = `sha-256:${'a'.repeat(64)}`;
      const undeclared = `sha-256:${'b'.repeat(64)}`;
      const build = (parents: string[]) =>
        signedEnvelope(
          buildEvent({
            actor,
            eventType: 'transformation_recorded',
            subject: { kind: 'transformation' },
            causalParents: parents.map((event_id) => ({ event_id })),
          }),
          actor,
        );
      await expect(
        ledger.appendEvent(build([declared, undeclared]), {
          publicKeys: publicKeysFor(actor),
          permittedMissingParentIds: [declared],
        }),
      ).rejects.toBeInstanceOf(MissingParentError);
      const ok = await ledger.appendEvent(build([declared]), {
        publicKeys: publicKeysFor(actor),
        permittedMissingParentIds: [declared],
      });
      expect(ok.duplicate).toBe(false);
    });

    it('serializes concurrent appends instead of failing with nested-transaction errors', async () => {
      const { ledger } = await setup([actor]);
      const envelopes = Array.from({ length: 8 }, () =>
        signedEnvelope(
          buildEvent({
            actor,
            eventType: 'genesis',
            subject: { kind: 'artifact', artifact_id: generateId() },
          }),
          actor,
        ),
      );
      const results = await Promise.all(
        envelopes.map((e) => ledger.appendEvent(e, { publicKeys: publicKeysFor(actor) })),
      );
      expect(results.map((r) => r.receipt.sequence).sort((a, b) => a - b)).toEqual([
        0, 1, 2, 3, 4, 5, 6, 7,
      ]);
    });

    it('resolves concurrent submissions of the same event to one receipt', async () => {
      const { ledger } = await setup([actor]);
      const envelope = signedEnvelope(
        buildEvent({
          actor,
          eventType: 'genesis',
          subject: { kind: 'artifact', artifact_id: generateId() },
        }),
        actor,
      );
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          ledger.appendEvent(envelope, { publicKeys: publicKeysFor(actor) }),
        ),
      );
      expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
      expect(new Set(results.map((r) => r.receipt.receipt_digest)).size).toBe(1);
    });

    it('stores ledger metadata durably: set, overwrite, create-if-absent, list by prefix, delete', async () => {
      const { adapter } = await setup([actor]);
      expect(await adapter.getMeta('a:1')).toBeNull();
      await adapter.setMeta('a:1', 'one');
      await adapter.setMeta('a:1', 'uno');
      expect(await adapter.getMeta('a:1')).toBe('uno');
      expect(await adapter.setMetaIfAbsent('a:1', 'x')).toBe(false);
      expect(await adapter.setMetaIfAbsent('a:2', 'two')).toBe(true);
      await adapter.setMeta('b_1', 'other');
      expect((await adapter.listMeta('a:')).map((r) => r.key)).toEqual(['a:1', 'a:2']);
      // LIKE wildcards in the prefix are matched literally, not as patterns.
      expect(await adapter.listMeta('%')).toEqual([]);
      expect(await adapter.listMeta('b_')).toEqual([{ key: 'b_1', value: 'other' }]);
      expect(await adapter.deleteMeta('a:1')).toBe(true);
      expect(await adapter.deleteMeta('a:1')).toBe(false);
    });

    it('getEffectiveVersion reports the latest authority-selected version, or null', async () => {
      const { ledger } = await setup([actor]);
      const artifactId = generateId();
      const root = signedEnvelope(
        buildEvent({
          actor,
          eventType: 'genesis',
          subject: {
            kind: 'artifact',
            artifact_id: artifactId,
            version_id: `sha-256:${'1'.repeat(64)}`,
          },
        }),
        actor,
      );
      await ledger.appendEvent(root, { publicKeys: publicKeysFor(actor) });
      expect(await ledger.getEffectiveVersion(artifactId)).toBeNull();
      const select = (n: string) =>
        signedEnvelope(
          buildEvent({
            actor,
            eventType: 'intent_effective_selected',
            subject: {
              kind: 'artifact',
              artifact_id: artifactId,
              version_id: `sha-256:${n.repeat(64)}`,
            },
            causalParents: [{ event_id: root.payloadDigest, relation: 'approval-of' }],
          }),
          actor,
        );
      await ledger.appendEvent(select('2'), { publicKeys: publicKeysFor(actor) });
      expect(await ledger.getEffectiveVersion(artifactId)).toBe(`sha-256:${'2'.repeat(64)}`);
      await ledger.appendEvent(select('3'), { publicKeys: publicKeysFor(actor) });
      expect(await ledger.getEffectiveVersion(artifactId)).toBe(`sha-256:${'3'.repeat(64)}`);
      // A selection is not a competing version.
      expect((await ledger.getTips(artifactId)).map((e) => e.eventId)).toEqual([
        root.payloadDigest,
      ]);
    });

    it('getTips reports a single tip for a linear history and every branch tip for a fork', async () => {
      const { ledger } = await setup([actor]);
      const artifactId = generateId();
      const root = signedEnvelope(
        buildEvent({
          actor,
          eventType: 'genesis',
          subject: {
            kind: 'artifact',
            artifact_id: artifactId,
            version_id: `sha-256:${'1'.repeat(64)}`,
          },
        }),
        actor,
      );
      await ledger.appendEvent(root, { publicKeys: publicKeysFor(actor) });
      const revision = (n: string) =>
        signedEnvelope(
          buildEvent({
            actor,
            eventType: 'artifact_revised',
            subject: {
              kind: 'artifact',
              artifact_id: artifactId,
              version_id: `sha-256:${n.repeat(64)}`,
            },
            causalParents: [{ event_id: root.payloadDigest, relation: 'revision-of' }],
          }),
          actor,
        );
      expect((await ledger.getTips(artifactId)).map((e) => e.eventId)).toEqual([
        root.payloadDigest,
      ]);
      const a = revision('2');
      const b = revision('3');
      await ledger.appendEvent(a, { publicKeys: publicKeysFor(actor) });
      expect((await ledger.getTips(artifactId)).map((e) => e.eventId)).toEqual([a.payloadDigest]);
      await ledger.appendEvent(b, { publicKeys: publicKeysFor(actor) });
      expect((await ledger.getTips(artifactId)).map((e) => e.eventId).sort()).toEqual(
        [a.payloadDigest, b.payloadDigest].sort(),
      );
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
