import type { FastifyPluginAsync } from 'fastify';
import { keyIdMatchesPublicKey } from '@act/crypto';
import {
  signCheckpoint,
  statementFor,
  verifyWitnessSignature,
  type SignedCheckpoint,
  type WitnessSignature,
} from '@act/ledger';
import { ApiProblemError, badRequest, forbidden, notFound } from '../problem.js';
import type { LedgerContext } from '../ledger-context.js';
import { assertAdmin, parseIntParam } from './shared.js';

const CHECKPOINT = (size: number) => `checkpoint:${size}`;
const COSIGNATURE = (size: number, keyId: string) => `checkpoint:${size}:witness:${keyId}`;
const WITNESS = (keyId: string) => `witness:${keyId}`;

interface WitnessRecord {
  keyId: string;
  publicKey: string;
  name?: string;
}

/**
 * The checkpoint for the ledger's current head (ADR 0013). It is signed once
 * per size and then returned unchanged: a ledger that signed two different
 * histories of the same size would be equivocating, so if what is stored for
 * this size does not match the chain, it refuses rather than sign again.
 */
async function currentCheckpoint(ctx: LedgerContext): Promise<SignedCheckpoint> {
  const head = await ctx.ledger.getHeadReceipt();
  const statement = statementFor(ctx.ledgerId, head);
  const key = CHECKPOINT(statement.size);

  let stored = await ctx.meta.getMeta(key);
  if (!stored) {
    const signed = signCheckpoint(
      { ...statement, issued_at: new Date().toISOString() },
      ctx.ledgerSigner,
    );
    await ctx.meta.setMetaIfAbsent(key, JSON.stringify(signed));
    stored = (await ctx.meta.getMeta(key))!;
  }
  const signed = JSON.parse(stored) as SignedCheckpoint;
  if (signed.checkpoint.head_digest !== statement.head_digest) {
    throw new ApiProblemError(
      409,
      'checkpoint_conflict',
      'A different checkpoint was already signed for this size',
      'The stored history and the ledger chain disagree; this ledger will not sign two histories of the same size.',
    );
  }
  const cosigs = await ctx.meta.listMeta(`${key}:witness:`);
  return {
    ...signed,
    witness_signatures: cosigs.map((c) => JSON.parse(c.value) as WitnessSignature),
  };
}

const checkpointRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/v1/checkpoint', async (request) => currentCheckpoint(request.ctx));

  // The material for consistency and inclusion proofs.
  fastify.get('/v1/receipts', async (request) => {
    const { after, limit } = request.query as { after?: string; limit?: string };
    const afterSequence = parseIntParam('after', after, {
      fallback: -1,
      min: -1,
      max: Number.MAX_SAFE_INTEGER,
    });
    const pageSize = parseIntParam('limit', limit, { fallback: 100, min: 1, max: 500 });
    return { items: await request.ctx.ledger.listReceipts(afterSequence, pageSize) };
  });

  fastify.post('/v1/witnesses', async (request, reply) => {
    const ctx = request.ctx;
    assertAdmin(ctx, request);
    const body = (request.body ?? {}) as { key_id?: string; public_key?: string; name?: string };
    if (!body.key_id || !body.public_key || !keyIdMatchesPublicKey(body.key_id, body.public_key)) {
      throw badRequest(
        'invalid_witness_key',
        'key_id must be the fingerprint of public_key (ed25519:<sha-256 of the raw public key>)',
      );
    }
    const record: WitnessRecord = {
      keyId: body.key_id,
      publicKey: body.public_key,
      ...(body.name ? { name: String(body.name).slice(0, 200) } : {}),
    };
    await ctx.meta.setMeta(WITNESS(record.keyId), JSON.stringify(record));
    reply.code(201).send(record);
  });

  fastify.get('/v1/witnesses', async (request) => {
    const rows = await request.ctx.meta.listMeta('witness:');
    return { items: rows.map((r) => JSON.parse(r.value) as WitnessRecord) };
  });

  fastify.delete('/v1/witnesses/:keyId', async (request) => {
    const ctx = request.ctx;
    assertAdmin(ctx, request);
    const { keyId } = request.params as { keyId: string };
    if (!(await ctx.meta.deleteMeta(WITNESS(keyId)))) throw notFound(`No witness ${keyId}`);
    return { removed: keyId };
  });

  // A witness hands back its cosignature. The ledger keeps it only if it is from
  // a registered witness and really covers this size's checkpoint; consumers
  // still verify against their own witness set.
  fastify.post('/v1/checkpoints/:size/witness', async (request, reply) => {
    const ctx = request.ctx;
    const size = parseIntParam('size', (request.params as { size: string }).size, {
      fallback: 0,
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
    });
    const stored = await ctx.meta.getMeta(CHECKPOINT(size));
    if (!stored) throw notFound(`No checkpoint of size ${size} was issued`);
    const checkpoint = (JSON.parse(stored) as SignedCheckpoint).checkpoint;

    const body = (request.body ?? {}) as Partial<WitnessSignature>;
    if (!body.key_id || !body.signature || !body.signed_at) {
      throw badRequest('invalid_witness_signature', 'key_id, signed_at and signature are required');
    }
    const witnessRaw = await ctx.meta.getMeta(WITNESS(body.key_id));
    if (!witnessRaw) throw forbidden(`${body.key_id} is not a registered witness of this ledger`);
    const witness = JSON.parse(witnessRaw) as WitnessRecord;
    const sig: WitnessSignature = {
      key_id: body.key_id,
      algorithm: 'ed25519',
      signed_at: body.signed_at,
      signature: body.signature,
    };
    if (!verifyWitnessSignature(checkpoint, sig, witness.publicKey)) {
      throw badRequest(
        'invalid_witness_signature',
        'The signature does not cover this checkpoint under the witness key',
      );
    }
    await ctx.meta.setMeta(COSIGNATURE(size, sig.key_id), JSON.stringify(sig));
    reply.code(201).send({ size, key_id: sig.key_id });
  });
};

export default checkpointRoutes;
