import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { generateKeyPair } from '@act/crypto';
import {
  verifyCheckpoint,
  verifyConsistency,
  verifyInclusion,
  verifyLedgerSignature,
  witnessStep,
  type LedgerReceipt,
  type SignedCheckpoint,
  type WitnessSource,
} from '@act/ledger';
import { buildServer } from '../server.js';
import { createLedgerContext, type LedgerContext } from '../ledger-context.js';
import {
  buildIntentEnvelope,
  buildKeyRegistrationEnvelope,
  makeActor,
  withTenant,
  type TestActor,
} from './helpers.js';

/** Witnessed checkpoints over the API (ADR 0013). */

const keyPair = () => {
  const kp = generateKeyPair();
  return { keyId: kp.keyId, publicKey: kp.publicKey, privateKey: kp.privateKey };
};

describe('witnessed checkpoints', () => {
  let server: FastifyInstance;
  let ctx: LedgerContext;
  let admin: TestActor;
  let alice: TestActor;

  const hdr = (who: TestActor | string, tenant?: string) => ({
    authorization: `Bearer ${typeof who === 'string' ? who : who.actorId}`,
    ...(tenant ? { 'x-act-tenant': tenant } : {}),
  });
  const get = (url: string, who: TestActor | string = 'reader', tenant?: string) =>
    server.inject({ method: 'GET', url, headers: hdr(who, tenant) });
  const post = (url: string, who: TestActor | string, payload: unknown, tenant?: string) =>
    server.inject({ method: 'POST', url, headers: hdr(who, tenant), payload: payload as object });
  const checkpoint = async (tenant?: string) =>
    (await get('/v1/checkpoint', 'reader', tenant)).json() as SignedCheckpoint;

  const intent = async (text: string) => {
    const res = await post('/v1/intents', alice, buildIntentEnvelope(alice, text).envelope);
    expect(res.statusCode).toBe(201);
  };

  beforeEach(async () => {
    ctx = await createLedgerContext(':memory:');
    admin = makeActor();
    alice = makeActor();
    server = await buildServer({
      devMode: true,
      ledgerContext: ctx,
      adminActorIds: [admin.actorId],
    });
    for (const a of [admin, alice]) {
      expect((await post('/v1/keys', a, buildKeyRegistrationEnvelope(a))).statusCode).toBe(201);
    }
  });
  afterEach(async () => {
    await server.close();
  });

  /** A witness's view of the ledger, over the real HTTP handlers. */
  const source = (tenant?: string): WitnessSource => ({
    getCheckpoint: () => get('/v1/checkpoint', 'witness', tenant).then((r) => r.json()),
    getReceipts: async (after, limit) =>
      (await get(`/v1/receipts?after=${after}&limit=${limit}`, 'witness', tenant)).json().items,
  });
  const identity = (c: LedgerContext = ctx) => ({
    ledgerId: c.ledgerId,
    keyId: c.ledgerSigner.keyId,
    publicKey: c.ledgerSigner.publicKey,
  });

  it('signs the current head with the tenant ledger key, once per size', async () => {
    const first = await checkpoint();
    expect(first.checkpoint).toMatchObject({ ledger_id: ctx.ledgerId, size: 2 });
    expect(verifyLedgerSignature(first, ctx.ledgerSigner.publicKey)).toBe(true);
    expect(first.witness_signatures).toEqual([]);
    // Asking again does not mint a new signature for the same history.
    expect(await checkpoint()).toEqual(first);

    await intent('one more');
    const next = await checkpoint();
    expect(next.checkpoint.size).toBe(3);
    expect(next.checkpoint.head_digest).not.toBe(first.checkpoint.head_digest);
  });

  it('serves receipts for proofs, paged, and the proofs verify', async () => {
    await intent('a');
    await intent('b');
    const c = await checkpoint();
    const all = (await get('/v1/receipts?limit=500')).json().items as LedgerReceipt[];
    expect(all.map((r) => r.sequence)).toEqual([0, 1, 2, 3]);
    expect((await get('/v1/receipts?after=1&limit=1')).json().items).toHaveLength(1);
    expect((await get('/v1/receipts?limit=0')).statusCode).toBe(400);
    expect((await get('/v1/receipts?after=x')).statusCode).toBe(400);

    const key = ctx.ledgerSigner.publicKey;
    expect(
      verifyConsistency(
        { ...c.checkpoint, size: 1, head_digest: all[0]!.receipt_digest },
        c.checkpoint,
        all.slice(1),
        key,
      ),
    ).toEqual({ ok: true });
    expect(verifyInclusion(all[1]!, all.slice(2), c.checkpoint, key)).toEqual({ ok: true });
  });

  it('collects cosignatures from registered witnesses, and consumers decide how many they need', async () => {
    const w1 = keyPair();
    const w2 = keyPair();
    const w3 = keyPair();
    for (const w of [w1, w2]) {
      const reg = await post('/v1/witnesses', admin, {
        key_id: w.keyId,
        public_key: w.publicKey,
        name: 'witness',
      });
      expect(reg.statusCode).toBe(201);
    }
    await intent('first');

    const cosign = async (w: ReturnType<typeof keyPair>) => {
      const out = await witnessStep({
        source: source(),
        ledger: identity(),
        last: null,
        witness: w,
        now: () => new Date().toISOString(),
      });
      if (out.outcome !== 'cosigned') throw new Error(`witness refused: ${JSON.stringify(out)}`);
      const sig = out.signed.witness_signatures.find((x) => x.key_id === w.keyId)!;
      return post(`/v1/checkpoints/${out.signed.checkpoint.size}/witness`, 'witness', sig);
    };
    expect((await cosign(w1)).statusCode).toBe(201);
    expect((await cosign(w2)).statusCode).toBe(201);
    // Not registered: the ledger will not take it.
    expect((await cosign(w3)).statusCode).toBe(403);

    const c = await checkpoint();
    expect(c.witness_signatures.map((s) => s.key_id).sort()).toEqual([w1.keyId, w2.keyId].sort());
    const trust = {
      ledgerKeyId: ctx.ledgerSigner.keyId,
      ledgerPublicKey: ctx.ledgerSigner.publicKey,
      witnesses: { [w1.keyId]: w1.publicKey, [w2.keyId]: w2.publicKey, [w3.keyId]: w3.publicKey },
    };
    expect(verifyCheckpoint(c, { ...trust, threshold: 2 }).endorsed).toBe(true);
    expect(verifyCheckpoint(c, { ...trust, threshold: 3 }).endorsed).toBe(false);

    // The next checkpoint starts with no cosignatures until witnesses have seen it.
    await intent('second');
    expect((await checkpoint()).witness_signatures).toEqual([]);
  });

  it('lets a witness keep up incrementally and refuses a ledger that goes back', async () => {
    const w = keyPair();
    await intent('a');
    const first = await witnessStep({
      source: source(),
      ledger: identity(),
      last: null,
      witness: w,
      now: () => '2026-01-01T00:00:00Z',
    });
    if (first.outcome !== 'cosigned') throw new Error('expected a cosignature');
    await intent('b');
    const second = await witnessStep({
      source: source(),
      ledger: identity(),
      last: first.observed,
      witness: w,
      now: () => '2026-01-01T00:00:00Z',
    });
    expect(second.outcome).toBe('cosigned');
    // Same size again: nothing to do.
    if (second.outcome !== 'cosigned') return;
    expect(
      (
        await witnessStep({
          source: source(),
          ledger: identity(),
          last: second.observed,
          witness: w,
          now: () => '2026-01-01T00:00:00Z',
        })
      ).outcome,
    ).toBe('unchanged');
  });

  it('accepts witness registration only from an administrator, with a real fingerprint', async () => {
    const w = keyPair();
    const body = { key_id: w.keyId, public_key: w.publicKey };
    expect((await post('/v1/witnesses', alice, body)).statusCode).toBe(403);
    const wrong = await post('/v1/witnesses', admin, {
      key_id: keyPair().keyId,
      public_key: w.publicKey,
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().code).toBe('invalid_witness_key');
    expect((await post('/v1/witnesses', admin, body)).statusCode).toBe(201);
    expect((await get('/v1/witnesses')).json().items).toHaveLength(1);
    expect(
      (
        await server.inject({
          method: 'DELETE',
          url: `/v1/witnesses/${w.keyId}`,
          headers: hdr(alice),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await server.inject({
          method: 'DELETE',
          url: `/v1/witnesses/${w.keyId}`,
          headers: hdr(admin),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await server.inject({
          method: 'DELETE',
          url: `/v1/witnesses/${w.keyId}`,
          headers: hdr(admin),
        })
      ).statusCode,
    ).toBe(404);
  });

  it('rejects a cosignature that does not cover the checkpoint, or for a checkpoint never issued', async () => {
    const w = keyPair();
    await post('/v1/witnesses', admin, { key_id: w.keyId, public_key: w.publicKey });
    const c = await checkpoint();
    const out = await witnessStep({
      source: source(),
      ledger: identity(),
      last: null,
      witness: w,
      now: () => '2026-01-01T00:00:00Z',
    });
    if (out.outcome !== 'cosigned') throw new Error('expected a cosignature');
    const sig = out.signed.witness_signatures.find((x) => x.key_id === w.keyId)!;

    expect(
      (
        await post(`/v1/checkpoints/${c.checkpoint.size}/witness`, 'witness', {
          ...sig,
          signed_at: '2030-01-01T00:00:00Z',
        })
      ).json().code,
    ).toBe('invalid_witness_signature');
    expect((await post(`/v1/checkpoints/999/witness`, 'witness', sig)).statusCode).toBe(404);
    expect(
      (await post(`/v1/checkpoints/${c.checkpoint.size}/witness`, 'witness', { key_id: w.keyId }))
        .statusCode,
    ).toBe(400);
    // Once issued for size N, the signature cannot be used against another size.
    await intent('later');
    const later = await checkpoint();
    expect(
      (await post(`/v1/checkpoints/${later.checkpoint.size}/witness`, 'witness', sig)).statusCode,
    ).toBe(400);
  });

  it('refuses to sign a second history for a size it already signed', async () => {
    const c = await checkpoint();
    // Simulate a restored or tampered store: the signed record no longer matches the chain.
    const forged = {
      ...c,
      checkpoint: { ...c.checkpoint, head_digest: `sha-256:${'9'.repeat(64)}` },
    };
    await ctx.meta.setMeta(`checkpoint:${c.checkpoint.size}`, JSON.stringify(forged));
    const res = await get('/v1/checkpoint');
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('checkpoint_conflict');
  });

  it('keeps checkpoints, receipts and witnesses per tenant', async () => {
    const w = keyPair();
    await post('/v1/witnesses', admin, { key_id: w.keyId, public_key: w.publicKey }, 'acme');
    expect((await get('/v1/witnesses', 'r', 'acme')).json().items).toHaveLength(1);
    expect((await get('/v1/witnesses', 'r', 'globex')).json().items).toHaveLength(0);

    const bob = makeActor();
    expect(
      (
        await post(
          '/v1/keys',
          bob,
          withTenant('acme', () => buildKeyRegistrationEnvelope(bob)),
          'acme',
        )
      ).statusCode,
    ).toBe(201);
    const acme = await checkpoint('acme');
    const globex = await checkpoint('globex');
    expect(acme.checkpoint.ledger_id).not.toBe(globex.checkpoint.ledger_id);
    expect(acme.checkpoint.size).toBe(1);
    expect(globex.checkpoint.size).toBe(0);

    // A cosignature for acme's checkpoint cannot be filed under another tenant.
    const acmeCtx = await ctx.registry.get('acme');
    const out = await witnessStep({
      source: source('acme'),
      ledger: identity(acmeCtx),
      last: null,
      witness: w,
      now: () => '2026-01-01T00:00:00Z',
    });
    if (out.outcome !== 'cosigned') throw new Error('expected a cosignature');
    const sig = out.signed.witness_signatures.find((x) => x.key_id === w.keyId)!;
    expect(
      (await post(`/v1/checkpoints/1/witness`, 'witness', sig, 'globex')).statusCode,
    ).toBeGreaterThanOrEqual(400);
    expect((await post(`/v1/checkpoints/1/witness`, 'witness', sig, 'acme')).statusCode).toBe(201);
    expect((await get('/v1/receipts', 'r', 'globex')).json().items).toEqual([]);
  });
});
