import type { FastifyPluginAsync } from 'fastify';
import { digestCanonicalValue, SCHEMA_IDS, validateAgainst } from '@act/core';
import { signBytes, verifyEnvelope } from '@act/crypto';
import type { LedgerContext } from '../ledger-context.js';
import { badRequest } from '../problem.js';

interface BundleEvent {
  signed_envelope: Record<string, unknown>;
  source_receipt: Record<string, unknown>;
}

/**
 * Mirrors routes/keys.ts's trust bootstrap for imported bundles: a Key
 * artifact event carries its own public key, so if that key genuinely
 * produces the event's attached signature, the importing ledger can trust
 * it immediately -- without this, every subsequent event signed by a key
 * this ledger has never seen would be unverifiable and quarantined.
 */
function tryBootstrapKeyFromEvent(ctx: LedgerContext, envelope: Record<string, unknown>): void {
  const eventPayload = (
    envelope as {
      payload?: { payload?: { artifact_type?: string; data?: Record<string, unknown> } };
    }
  ).payload;
  const keyPayload = eventPayload?.payload;
  if (keyPayload?.artifact_type !== 'Key') return;
  const data = keyPayload.data as
    { key_id?: string; public_key?: string; owner_actor_id?: string; status?: string } | undefined;
  if (!data?.key_id || !data.public_key || ctx.keyRegistry.get(data.key_id)) return;

  const proofCheck = verifyEnvelope(envelope as any, { [data.key_id]: data.public_key });
  const selfSignatureValid =
    proofCheck.digestValid &&
    proofCheck.signatures.some((s) => s.key_id === data.key_id && s.valid);
  if (!selfSignatureValid) return;

  ctx.keyRegistry.register({
    keyId: data.key_id,
    publicKey: data.public_key,
    ownerActorId: data.owner_actor_id ?? 'unknown',
    status: (data.status as 'issued' | 'active') ?? 'active',
  });
}

/**
 * Bundle export/import per spec/federation.md. This Phase 1 implementation
 * exports/imports against this single ledger only (no peer-ledger network
 * transport); see docs/roadmap.md for the deferred multi-ledger federation
 * transport and quarantine-review UI.
 */
const bundleRoutes: FastifyPluginAsync<{ ctx: LedgerContext }> = async (fastify, { ctx }) => {
  fastify.post('/v1/bundles/export', async (request) => {
    const { artifactIds } = (request.body as { artifactIds?: string[] }) ?? {};
    const events =
      artifactIds && artifactIds.length > 0
        ? artifactIds.flatMap((id) => ctx.ledger.listEventsForArtifact(id))
        : ctx.ledger.listEvents(10_000);

    const bundleEvents: BundleEvent[] = events.map((e) => ({
      signed_envelope: e.envelope as unknown as Record<string, unknown>,
      source_receipt: ctx.ledger.getReceipt(e.sequence) as unknown as Record<string, unknown>,
    }));

    const bundleBody = {
      source_ledger_id: ctx.ledgerId,
      exported_at: new Date().toISOString(),
      events: bundleEvents,
      completeness: { scope: 'complete' as const, known_gaps: [] },
    };
    const bundleId = digestCanonicalValue(bundleBody);
    const signature = signBytes(
      ctx.ledgerSigner.privateKey,
      ctx.ledgerSigner.publicKey,
      new TextEncoder().encode(bundleId),
    );

    return {
      bundle_id: bundleId,
      ...bundleBody,
      signature: { key_id: ctx.ledgerSigner.keyId, algorithm: 'ed25519', signature },
    };
  });

  fastify.post('/v1/bundles/import', async (request) => {
    const bundleResult = validateAgainst(SCHEMA_IDS.bundle, request.body);
    if (!bundleResult.valid) {
      throw badRequest(
        'schema_invalid',
        'Request body is not a well-formed signed event bundle',
        JSON.stringify(bundleResult.errors),
      );
    }
    const bundle = request.body as { events: BundleEvent[] };

    let accepted = 0;
    let duplicate = 0;
    const quarantined: string[] = [];

    for (const item of bundle.events) {
      try {
        const envelope = item.signed_envelope as any;
        tryBootstrapKeyFromEvent(ctx, envelope);
        const result = ctx.ledger.appendEvent(envelope, {
          publicKeys: ctx.keyRegistry.publicKeysByKeyId(),
          allowPartialImport: true,
        });
        if (result.duplicate) duplicate++;
        else accepted++;
      } catch (err) {
        ctx.ledger.quarantine(
          err instanceof Error ? err.message : 'unknown import failure',
          item.signed_envelope as any,
        );
        quarantined.push(
          String((item.signed_envelope as { payloadDigest?: string }).payloadDigest ?? 'unknown'),
        );
      }
    }

    return { accepted, duplicate, quarantined };
  });

  fastify.get('/v1/quarantine', async () => ({ items: ctx.ledger.listQuarantine() }));
};

export default bundleRoutes;
