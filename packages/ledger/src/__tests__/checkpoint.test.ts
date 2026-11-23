import { describe, expect, it } from 'vitest';
import { generateId } from '@act/core';
import { generateKeyPair } from '@act/crypto';
import {
  cosignCheckpoint,
  detectCheckpointEquivocation,
  signCheckpoint,
  statementFor,
  verifyCheckpoint,
  verifyConsistency,
  verifyInclusion,
  verifyLedgerSignature,
  verifyWitnessSignature,
  witnessSignature,
  witnessStep,
  type SignedCheckpoint,
  type WitnessSource,
} from '../checkpoint.js';
import { GENESIS_RECEIPT_DIGEST } from '../receipts.js';
import { Ledger } from '../ledger.js';
import { SqliteAdapter } from '../sqlite-adapter.js';
import { allowlistTrustPolicy } from '../types.js';
import { buildEvent, makeActor, publicKeysFor, signedEnvelope } from './helpers.js';

/** Witnessed checkpoints (ADR 0013). */

const keyPair = () => {
  const kp = generateKeyPair();
  return { keyId: kp.keyId, publicKey: kp.publicKey, privateKey: kp.privateKey };
};

const actor = makeActor();

async function makeLedger(ledgerId: string, signer = keyPair()) {
  const adapter = SqliteAdapter.open(':memory:');
  await adapter.migrate();
  const ledger = new Ledger({
    ledgerId,
    adapter,
    signer,
    trustPolicy: allowlistTrustPolicy([actor.signer.keyId]),
  });
  return { ledger, signer };
}

async function append(ledger: Ledger, n: number) {
  for (let i = 0; i < n; i++) {
    await ledger.appendEvent(
      signedEnvelope(
        buildEvent({
          actor,
          eventType: 'genesis',
          subject: {
            kind: 'artifact',
            artifact_id: generateId(),
            version_id: `sha-256:${'1'.repeat(64)}`,
          },
        }),
        actor,
      ),
      { publicKeys: publicKeysFor(actor) },
    );
  }
}

const sourceOf = (ledger: Ledger, signer: ReturnType<typeof keyPair>): WitnessSource => ({
  getCheckpoint: async () => signCheckpoint(await ledger.checkpoint(), signer),
  getReceipts: (after, limit) => ledger.listReceipts(after, limit),
});

describe('checkpoints', () => {
  it('commit to the head of the chain and are signed by the ledger', async () => {
    const id = generateId();
    const { ledger, signer } = await makeLedger(id);
    const empty = await ledger.checkpoint();
    expect(empty).toMatchObject({ ledger_id: id, size: 0, head_digest: GENESIS_RECEIPT_DIGEST });

    await append(ledger, 3);
    const c = await ledger.checkpoint();
    const head = (await ledger.getHeadReceipt())!;
    expect(c).toMatchObject({ size: 3, head_digest: head.receipt_digest });
    expect(head.sequence).toBe(2);

    const signed = signCheckpoint(c, signer);
    expect(verifyLedgerSignature(signed, signer.publicKey)).toBe(true);
    expect(verifyLedgerSignature(signed, keyPair().publicKey)).toBe(false);
    const tampered: SignedCheckpoint = { ...signed, checkpoint: { ...c, size: 2 } };
    expect(verifyLedgerSignature(tampered, signer.publicKey)).toBe(false);
  });

  it('keeps ledger and witness signatures in separate domains', () => {
    const ledger = keyPair();
    const witness = keyPair();
    const statement = { ledger_id: 'L', size: 1, head_digest: `sha-256:${'a'.repeat(64)}` };
    const signed = signCheckpoint({ ...statement, issued_at: '2026-01-01T00:00:00Z' }, ledger);
    // A witness signature is not a valid ledger signature, and a ledger signature is not a witness one.
    const w = witnessSignature(statement, witness, '2026-01-01T00:00:00Z');
    expect(
      verifyLedgerSignature(
        { ...signed, ledger_signature: { ...signed.ledger_signature, signature: w.signature } },
        witness.publicKey,
      ),
    ).toBe(false);
    expect(
      verifyWitnessSignature(
        statement,
        { ...w, signature: signed.ledger_signature.signature },
        ledger.publicKey,
      ),
    ).toBe(false);
    expect(verifyWitnessSignature(statement, w, witness.publicKey)).toBe(true);
    // And a witness signature does not cover a different statement.
    expect(verifyWitnessSignature({ ...statement, size: 2 }, w, witness.publicKey)).toBe(false);
  });

  it('are endorsed only by a quorum of distinct, trusted witnesses', () => {
    const ledger = keyPair();
    const [w1, w2, w3, stranger] = [keyPair(), keyPair(), keyPair(), keyPair()];
    const trust = {
      ledgerKeyId: ledger.keyId,
      ledgerPublicKey: ledger.publicKey,
      witnesses: { [w1.keyId]: w1.publicKey, [w2.keyId]: w2.publicKey, [w3.keyId]: w3.publicKey },
      threshold: 2,
    };
    const base = signCheckpoint(
      {
        ledger_id: 'L',
        size: 4,
        head_digest: `sha-256:${'b'.repeat(64)}`,
        issued_at: '2026-01-01T00:00:00Z',
      },
      ledger,
    );
    const at = '2026-01-01T01:00:00Z';

    expect(verifyCheckpoint(base, trust)).toMatchObject({ validWitnesses: [], endorsed: false });
    const one = cosignCheckpoint(base, w1, at);
    expect(verifyCheckpoint(one, trust).endorsed).toBe(false);
    // The same witness twice still counts once.
    const twice = cosignCheckpoint(one, w1, '2026-01-01T02:00:00Z');
    expect(twice.witness_signatures).toHaveLength(1);
    expect(verifyCheckpoint(twice, trust).endorsed).toBe(false);
    // A witness outside the consumer's set counts for nothing.
    expect(verifyCheckpoint(cosignCheckpoint(one, stranger, at), trust).endorsed).toBe(false);
    // A cosignature for a different statement counts for nothing.
    const other = cosignCheckpoint(signCheckpoint({ ...base.checkpoint, size: 5 }, ledger), w2, at);
    const mixed: SignedCheckpoint = {
      ...one,
      witness_signatures: [...one.witness_signatures, ...other.witness_signatures],
    };
    expect(verifyCheckpoint(mixed, trust).endorsed).toBe(false);
    // Two distinct trusted witnesses: endorsed.
    const two = cosignCheckpoint(one, w2, at);
    expect(verifyCheckpoint(two, trust)).toMatchObject({ endorsed: true });
    // But not if the ledger signature is not the pinned key's.
    expect(verifyCheckpoint(two, { ...trust, ledgerPublicKey: keyPair().publicKey }).endorsed).toBe(
      false,
    );
  });
});

describe('consistency and inclusion proofs', () => {
  async function history(n: number) {
    const id = generateId();
    const made = await makeLedger(id);
    await append(made.ledger, n);
    const receipts = await made.ledger.listReceipts(-1, 100);
    const at = (size: number) => statementFor(id, size === 0 ? null : receipts[size - 1]!);
    return { ...made, id, receipts, at };
  }

  it('prove that a newer checkpoint extends an older one', async () => {
    const h = await history(6);
    const key = h.signer.publicKey;
    expect(verifyConsistency(h.at(0), h.at(6), h.receipts, key)).toEqual({ ok: true });
    expect(verifyConsistency(h.at(2), h.at(6), h.receipts.slice(2), key)).toEqual({ ok: true });
    expect(verifyConsistency(h.at(6), h.at(6), [], key)).toEqual({ ok: true });
  });

  it('reject a missing, reordered, forged, or foreign receipt, and a shrunk or forked history', async () => {
    const h = await history(5);
    const key = h.signer.publicKey;
    const proof = h.receipts.slice(2);
    expect(verifyConsistency(h.at(2), h.at(5), proof.slice(1), key).ok).toBe(false);
    expect(verifyConsistency(h.at(2), h.at(5), [proof[1]!, proof[0]!, proof[2]!], key).ok).toBe(
      false,
    );
    const forged = proof.map((r, i) =>
      i === 1 ? { ...r, event_id: 'sha-256:' + 'e'.repeat(64) } : r,
    );
    expect(verifyConsistency(h.at(2), h.at(5), forged, key).ok).toBe(false);
    expect(verifyConsistency(h.at(2), h.at(5), proof, keyPair().publicKey).ok).toBe(false);
    expect(verifyConsistency(h.at(5), h.at(2), [], key)).toMatchObject({ ok: false });
    expect(
      verifyConsistency(h.at(5), { ...h.at(5), head_digest: `sha-256:${'f'.repeat(64)}` }, [], key),
    ).toMatchObject({ ok: false });
    expect(verifyConsistency(h.at(2), { ...h.at(5), ledger_id: 'other' }, proof, key).ok).toBe(
      false,
    );
    // The receipts must really reach the claimed head.
    expect(
      verifyConsistency(h.at(2), { ...h.at(5), head_digest: h.at(4).head_digest }, proof, key).ok,
    ).toBe(false);
  });

  it('show that an event is in a checkpoint', async () => {
    const h = await history(5);
    const key = h.signer.publicKey;
    const target = h.receipts[1]!;
    expect(verifyInclusion(target, h.receipts.slice(2), h.at(5), key)).toEqual({ ok: true });
    expect(verifyInclusion(target, h.receipts.slice(3), h.at(5), key).ok).toBe(false);
    expect(verifyInclusion(h.receipts[4]!, [], h.at(4), key).ok).toBe(false); // beyond the checkpoint
    expect(
      verifyInclusion({ ...target, receipt_digest: 'x' }, h.receipts.slice(2), h.at(5), key).ok,
    ).toBe(false);
    expect(
      verifyInclusion(target, h.receipts.slice(2), { ...h.at(5), ledger_id: 'o' }, key).ok,
    ).toBe(false);
  });
});

describe('equivocation', () => {
  it('is proven by two ledger-signed checkpoints of the same size with different heads', async () => {
    const id = generateId();
    const shared = keyPair();
    const a = await makeLedger(id, shared);
    const b = await makeLedger(id, shared);
    await append(a.ledger, 3);
    await append(b.ledger, 3); // the same operator, a different third event
    const ca = signCheckpoint(await a.ledger.checkpoint(), shared);
    const cb = signCheckpoint(await b.ledger.checkpoint(), shared);
    expect(detectCheckpointEquivocation(ca, cb, shared.publicKey)).toMatchObject({
      equivocation: true,
      size: 3,
    });
    expect(detectCheckpointEquivocation(ca, ca, shared.publicKey)).toMatchObject({
      equivocation: false,
    });
    expect(detectCheckpointEquivocation(ca, cb, keyPair().publicKey)).toMatchObject({
      equivocation: false,
    });
    await append(b.ledger, 1);
    const cb4 = signCheckpoint(await b.ledger.checkpoint(), shared);
    expect(detectCheckpointEquivocation(ca, cb4, shared.publicKey)).toMatchObject({
      equivocation: false,
    });
    const other = signCheckpoint({ ...(await a.ledger.checkpoint()), ledger_id: 'x' }, shared);
    expect(detectCheckpointEquivocation(ca, other, shared.publicKey)).toMatchObject({
      equivocation: false,
    });
  });
});

describe('a witness', () => {
  const clock = () => '2026-01-01T00:00:00Z';

  it('verifies from genesis on first sight, then only what was added, and cosigns each', async () => {
    const id = generateId();
    const { ledger, signer } = await makeLedger(id);
    await append(ledger, 3);
    const witness = keyPair();
    const identity = { ledgerId: id, keyId: signer.keyId, publicKey: signer.publicKey };
    const calls: [number, number][] = [];
    const source = sourceOf(ledger, signer);
    const counting: WitnessSource = {
      getCheckpoint: source.getCheckpoint,
      getReceipts: (after, limit) => {
        calls.push([after, limit]);
        return source.getReceipts(after, limit);
      },
    };

    const first = await witnessStep({
      source: counting,
      ledger: identity,
      last: null,
      witness,
      now: clock,
    });
    expect(first.outcome).toBe('cosigned');
    if (first.outcome !== 'cosigned') return;
    expect(calls[0]).toEqual([-1, 3]); // the whole chain from genesis
    expect(first.signed.witness_signatures.map((w) => w.key_id)).toEqual([witness.keyId]);

    expect(
      (
        await witnessStep({
          source: counting,
          ledger: identity,
          last: first.observed,
          witness,
          now: clock,
        })
      ).outcome,
    ).toBe('unchanged');

    await append(ledger, 2);
    calls.length = 0;
    const next = await witnessStep({
      source: counting,
      ledger: identity,
      last: first.observed,
      witness,
      now: clock,
    });
    expect(next.outcome).toBe('cosigned');
    expect(calls[0]).toEqual([2, 2]); // only the two new receipts
  });

  it('refuses a ledger that went back, forked, or would not show its receipts', async () => {
    const id = generateId();
    const shared = keyPair();
    const honest = await makeLedger(id, shared);
    const forked = await makeLedger(id, shared);
    await append(honest.ledger, 4);
    await append(forked.ledger, 4);
    const witness = keyPair();
    const identity = { ledgerId: id, keyId: shared.keyId, publicKey: shared.publicKey };

    const seen = await witnessStep({
      source: sourceOf(honest.ledger, shared),
      ledger: identity,
      last: null,
      witness,
      now: clock,
    });
    if (seen.outcome !== 'cosigned') throw new Error('expected a cosignature');

    // The same operator now shows a different history of the same size.
    const fork = await witnessStep({
      source: sourceOf(forked.ledger, shared),
      ledger: identity,
      last: seen.observed,
      witness,
      now: clock,
    });
    expect(fork.outcome).toBe('refused');
    if (fork.outcome === 'refused') {
      expect(fork.equivocation).toBeDefined();
      expect(
        detectCheckpointEquivocation(
          fork.equivocation!.first,
          fork.equivocation!.second,
          shared.publicKey,
        ),
      ).toMatchObject({ equivocation: true });
    }

    // A ledger that rolled back.
    const rolledBack = await makeLedger(id, shared);
    await append(rolledBack.ledger, 2);
    const back = await witnessStep({
      source: sourceOf(rolledBack.ledger, shared),
      ledger: identity,
      last: seen.observed,
      witness,
      now: clock,
    });
    expect(back).toMatchObject({ outcome: 'refused' });

    // A longer history that does not extend the one the witness cosigned.
    await append(forked.ledger, 2);
    const diverged = await witnessStep({
      source: sourceOf(forked.ledger, shared),
      ledger: identity,
      last: seen.observed,
      witness,
      now: clock,
    });
    expect(diverged).toMatchObject({ outcome: 'refused' });

    // A ledger that signs a head but withholds the receipts leading to it.
    await append(honest.ledger, 2);
    const hiding: WitnessSource = {
      getCheckpoint: sourceOf(honest.ledger, shared).getCheckpoint,
      getReceipts: async () => [],
    };
    expect(
      await witnessStep({
        source: hiding,
        ledger: identity,
        last: seen.observed,
        witness,
        now: clock,
      }),
    ).toMatchObject({
      outcome: 'refused',
    });
  });

  it('refuses a checkpoint not signed by the pinned ledger key or for another ledger', async () => {
    const id = generateId();
    const { ledger, signer } = await makeLedger(id);
    await append(ledger, 1);
    const witness = keyPair();
    const impostor = keyPair();
    const identity = { ledgerId: id, keyId: signer.keyId, publicKey: signer.publicKey };
    const unsigned: WitnessSource = {
      getCheckpoint: async () => signCheckpoint(await ledger.checkpoint(), impostor),
      getReceipts: (a, l) => ledger.listReceipts(a, l),
    };
    expect(
      await witnessStep({ source: unsigned, ledger: identity, last: null, witness, now: clock }),
    ).toMatchObject({
      outcome: 'refused',
    });
    expect(
      await witnessStep({
        source: sourceOf(ledger, signer),
        ledger: { ...identity, ledgerId: 'someone-else' },
        last: null,
        witness,
        now: clock,
      }),
    ).toMatchObject({ outcome: 'refused' });
  });

  it('pages through a long chain', async () => {
    const id = generateId();
    const { ledger, signer } = await makeLedger(id);
    await append(ledger, 7);
    const pages: number[] = [];
    const source = sourceOf(ledger, signer);
    const small: WitnessSource = {
      getCheckpoint: source.getCheckpoint,
      getReceipts: (after, limit) => {
        pages.push(limit);
        return source.getReceipts(after, Math.min(limit, 3));
      },
    };
    const out = await witnessStep({
      source: small,
      ledger: { ledgerId: id, keyId: signer.keyId, publicKey: signer.publicKey },
      last: null,
      witness: keyPair(),
      now: clock,
    });
    expect(out.outcome).toBe('cosigned');
    expect(pages.length).toBeGreaterThan(1);
  });
});

describe('receipt listing', () => {
  it('is per ledger, ordered, and paged', async () => {
    const adapter = SqliteAdapter.open(':memory:');
    await adapter.migrate();
    const mk = (id: string) =>
      new Ledger({
        ledgerId: id,
        adapter,
        signer: keyPair(),
        trustPolicy: allowlistTrustPolicy([actor.signer.keyId]),
      });
    const a = mk('A');
    const b = mk('B');
    await append(a, 4);
    await append(b, 2);
    expect((await a.listReceipts(-1, 100)).map((r) => r.sequence)).toEqual([0, 1, 2, 3]);
    expect((await a.listReceipts(1, 2)).map((r) => r.sequence)).toEqual([2, 3]);
    expect((await b.listReceipts(-1, 100)).map((r) => r.ledger_id)).toEqual(['B', 'B']);
    expect((await b.getHeadReceipt())!.sequence).toBe(1);
    expect(await mk('C').getHeadReceipt()).toBeNull();
  });
});
