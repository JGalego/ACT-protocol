import { afterEach, describe, expect, it } from 'vitest';
import { generateId } from '@act/core';
import { generateKeyPair } from '@act/crypto';
import { Ledger } from '../../ledger.js';
import type { StorageAdapter } from '../../storage-adapter.js';
import { allowlistTrustPolicy } from '../../types.js';
import { MissingParentError, TenantMismatchError } from '../../errors.js';
import { GENESIS_RECEIPT_DIGEST } from '../../receipts.js';
import { buildEvent, makeActor, publicKeysFor, signedEnvelope } from '../helpers.js';

/**
 * Several ledgers (one per tenant, ADR 0010) share one database. Everything a
 * ledger reads or writes must stay inside its own ledger id, on every storage
 * engine.
 */
const V1 = `sha-256:${'1'.repeat(64)}`;
const V2 = `sha-256:${'2'.repeat(64)}`;

export function registerTenantSuite(
  dialectName: string,
  makeAdapter: () => Promise<StorageAdapter>,
  cleanupAdapter?: (adapter: StorageAdapter) => Promise<void>,
): void {
  const open: StorageAdapter[] = [];
  afterEach(async () => {
    if (cleanupAdapter) for (const a of open.splice(0)) await cleanupAdapter(a);
  });

  async function twoLedgers(tenants?: { a: string; b: string }) {
    const adapter = await makeAdapter();
    open.push(adapter);
    const actor = makeActor();
    const make = (tenant?: string, trusted: string[] = [actor.signer.keyId]) => {
      const kp = generateKeyPair();
      return new Ledger({
        ledgerId: generateId(),
        adapter,
        signer: { keyId: kp.keyId, publicKey: kp.publicKey, privateKey: kp.privateKey },
        trustPolicy: allowlistTrustPolicy(trusted),
        ...(tenant ? { tenant } : {}),
      });
    };
    return { adapter, actor, make, a: make(tenants?.a), b: make(tenants?.b) };
  }

  const genesis = (actor: ReturnType<typeof makeActor>, artifactId: string, tenant?: string) =>
    signedEnvelope(
      {
        ...buildEvent({
          actor,
          eventType: 'genesis',
          subject: { kind: 'artifact', artifact_id: artifactId, version_id: V1 },
        }),
        ...(tenant ? { tenant } : {}),
      },
      actor,
    );

  describe(`tenant-scoped ledgers sharing one store [${dialectName}]`, () => {
    it('lets two ledgers hold the same event without either noticing the other', async () => {
      const { a, b, actor } = await twoLedgers();
      const envelope = genesis(actor, generateId());
      const first = await a.appendEvent(envelope, { publicKeys: publicKeysFor(actor) });
      const second = await b.appendEvent(envelope, { publicKeys: publicKeysFor(actor) });
      // Not a duplicate: B has never seen it, whatever A holds.
      expect(first.duplicate).toBe(false);
      expect(second.duplicate).toBe(false);
      expect(first.receipt.ledger_id).toBe(a.ledgerId);
      expect(second.receipt.ledger_id).toBe(b.ledgerId);
      expect(second.receipt.sequence).toBe(0);
    });

    it('keeps one gap-free receipt chain per ledger, starting from genesis', async () => {
      const { a, b, actor } = await twoLedgers();
      await a.appendEvent(genesis(actor, generateId()), { publicKeys: publicKeysFor(actor) });
      await a.appendEvent(genesis(actor, generateId()), { publicKeys: publicKeysFor(actor) });
      const onlyB = await b.appendEvent(genesis(actor, generateId()), {
        publicKeys: publicKeysFor(actor),
      });
      expect(onlyB.receipt.sequence).toBe(0);
      expect(onlyB.receipt.previous_receipt_digest).toBe(GENESIS_RECEIPT_DIGEST);
      expect((await a.listEvents()).map((e) => e.sequence)).toEqual([0, 1]);
      expect((await b.listEvents()).map((e) => e.sequence)).toEqual([0]);
      expect(await b.getReceipt(1)).toBeNull();
    });

    it("never returns another ledger's events, heads, lineage or quarantine", async () => {
      const { a, b, actor } = await twoLedgers();
      const artifactId = generateId();
      const root = await a.appendEvent(genesis(actor, artifactId), {
        publicKeys: publicKeysFor(actor),
      });
      const child = signedEnvelope(
        buildEvent({
          actor,
          eventType: 'artifact_revised',
          subject: { kind: 'artifact', artifact_id: artifactId, version_id: V2 },
          causalParents: [{ event_id: root.event.eventId, relation: 'revision-of' }],
        }),
        actor,
      );
      const childEvent = await a.appendEvent(child, { publicKeys: publicKeysFor(actor) });
      await a.quarantine('only A', child);

      expect(await b.getEvent(root.event.eventId)).toBeNull();
      expect(await b.getHead(artifactId)).toBeNull();
      expect(await b.listEvents()).toEqual([]);
      expect(await b.listEventsForArtifact(artifactId)).toEqual([]);
      expect(await b.queryEvents({ eventTypes: ['genesis'] })).toEqual([]);
      expect(await b.getTips(artifactId)).toEqual([]);
      expect(await b.getLineage(childEvent.event.eventId)).toMatchObject({
        ancestors: [],
        descendants: [],
        boundaries: [],
      });
      expect(await b.listQuarantine()).toEqual([]);
      expect(await b.findForks()).toEqual([]);
      expect(await b.getReceipt(0)).toBeNull();
      expect(await b.getSourceReceipt(root.event.eventId)).toBeNull();

      // And A still sees all of it.
      expect(await a.getHead(artifactId)).toEqual({
        versionId: V2,
        eventId: childEvent.event.eventId,
      });
      expect(await a.listQuarantine()).toHaveLength(1);
    });

    it("treats another ledger's event as a missing parent, not as an existing one", async () => {
      const { a, b, actor } = await twoLedgers();
      const root = await a.appendEvent(genesis(actor, generateId()), {
        publicKeys: publicKeysFor(actor),
      });
      const orphan = signedEnvelope(
        buildEvent({
          actor,
          eventType: 'transformation_recorded',
          subject: { kind: 'transformation' },
          causalParents: [{ event_id: root.event.eventId, relation: 'input' }],
        }),
        actor,
      );
      await expect(b.appendEvent(orphan, { publicKeys: publicKeysFor(actor) })).rejects.toThrow(
        MissingParentError,
      );
    });

    it('does not let one ledger take over, or block, an artifact id another ledger holds', async () => {
      const { a, make, actor } = await twoLedgers();
      const other = makeActor();
      const b = make(undefined, [other.signer.keyId]);
      const artifactId = generateId();
      await a.appendEvent(genesis(actor, artifactId), { publicKeys: publicKeysFor(actor) });
      // A different actor creating the same artifact id in another tenant's ledger is not a takeover.
      await expect(
        b.appendEvent(genesis(other, artifactId), { publicKeys: publicKeysFor(other) }),
      ).resolves.toMatchObject({ duplicate: false });
    });

    it("rebuilding one ledger's projections leaves the other's untouched", async () => {
      const { a, b, actor } = await twoLedgers();
      const idA = generateId();
      const idB = generateId();
      await a.appendEvent(genesis(actor, idA), { publicKeys: publicKeysFor(actor) });
      await b.appendEvent(genesis(actor, idB), { publicKeys: publicKeysFor(actor) });
      await a.rebuildProjections();
      expect(await a.getHead(idA)).not.toBeNull();
      expect(await b.getHead(idB)).not.toBeNull();
      expect(await a.getHead(idB)).toBeNull();
    });

    it('finds an idempotency key only in the ledger that used it', async () => {
      const { a, b, actor } = await twoLedgers();
      await a.appendEvent(genesis(actor, generateId()), {
        publicKeys: publicKeysFor(actor),
        idempotencyKey: 'shared-key',
      });
      const fresh = await b.appendEvent(genesis(actor, generateId()), {
        publicKeys: publicKeysFor(actor),
        idempotencyKey: 'shared-key',
      });
      expect(fresh.duplicate).toBe(false);
    });
  });

  describe(`ledger tenant binding [${dialectName}]`, () => {
    it('accepts events that state the ledger tenant and refuses any other', async () => {
      const { a, actor } = await twoLedgers({ a: 'acme', b: 'globex' });
      await expect(
        a.appendEvent(genesis(actor, generateId(), 'acme'), { publicKeys: publicKeysFor(actor) }),
      ).resolves.toMatchObject({ duplicate: false });
      await expect(
        a.appendEvent(genesis(actor, generateId(), 'globex'), {
          publicKeys: publicKeysFor(actor),
        }),
      ).rejects.toThrow(TenantMismatchError);
    });

    it('refuses an event that opts out of tenancy', async () => {
      const { a, actor } = await twoLedgers({ a: 'acme', b: 'globex' });
      const notApplicable = signedEnvelope(
        {
          ...buildEvent({
            actor,
            eventType: 'genesis',
            subject: { kind: 'artifact', artifact_id: generateId(), version_id: V1 },
          }),
          tenant: { not_applicable: true, reason: 'trying to be portable' },
        },
        actor,
      );
      await expect(
        a.appendEvent(notApplicable, { publicKeys: publicKeysFor(actor) }),
      ).rejects.toThrow(TenantMismatchError);
    });

    it('lets a federation import keep the tenant of the ledger that authored it', async () => {
      const { a, b, actor } = await twoLedgers({ a: 'acme', b: 'globex' });
      const written = await b.appendEvent(genesis(actor, generateId(), 'globex'), {
        publicKeys: publicKeysFor(actor),
      });
      const imported = await a.appendEvent(genesis(actor, generateId(), 'globex'), {
        publicKeys: publicKeysFor(actor),
        sourceReceipt: written.receipt,
      });
      expect(imported.duplicate).toBe(false);
    });

    it('does not tenant-scope a ledger created without a tenant', async () => {
      const { a, actor } = await twoLedgers();
      await expect(
        a.appendEvent(genesis(actor, generateId(), 'anything'), {
          publicKeys: publicKeysFor(actor),
        }),
      ).resolves.toMatchObject({ duplicate: false });
    });
  });
}
