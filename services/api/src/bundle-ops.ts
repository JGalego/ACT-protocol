import { digestCanonicalValue, SCHEMA_IDS, validateAgainst } from '@act/core';
import { signBytes, verifyEnvelope, type SignedEnvelope } from '@act/crypto';
import type { LedgerReceipt } from '@act/ledger';
import type { LedgerContext } from './ledger-context.js';
import { badRequest } from './problem.js';

export interface BundleEvent {
  signed_envelope: Record<string, unknown>;
  source_receipt: Record<string, unknown>;
}

export interface SignedBundle {
  bundle_id: string;
  source_ledger_id: string;
  exported_at: string;
  events: BundleEvent[];
  completeness: { scope: 'complete' | 'partial'; known_gaps: unknown[] };
  signature: { key_id: string; algorithm: 'ed25519'; signature: string };
}

export interface ImportSummary {
  accepted: number;
  duplicate: number;
  quarantined: string[];
}

/**
 * Mirrors routes/keys.ts's trust bootstrap for imported bundles: a Key
 * artifact event carries its own public key, so if that key genuinely
 * produces the event's attached signature, the importing ledger can trust
 * it immediately -- without this, every subsequent event signed by a key
 * this ledger has never seen would be unverifiable and quarantined. Shared
 * by both the direct bundle-import route and the peer-pull federation
 * route (routes/federation.ts) so they can never drift.
 */
export function tryBootstrapKeyFromEvent(
  ctx: LedgerContext,
  envelope: Record<string, unknown>,
): void {
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

  const proofCheck = verifyEnvelope(envelope as unknown as SignedEnvelope, {
    [data.key_id]: data.public_key,
  });
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

/** Builds and signs an export bundle of this ledger's own events (spec/federation.md section 2). */
export async function buildExportBundle(
  ctx: LedgerContext,
  artifactIds?: string[],
): Promise<SignedBundle> {
  const events =
    artifactIds && artifactIds.length > 0
      ? (await Promise.all(artifactIds.map((id) => ctx.ledger.listEventsForArtifact(id)))).flat()
      : await ctx.ledger.listEvents(10_000);

  const bundleEvents: BundleEvent[] = await Promise.all(
    events.map(async (e) => ({
      signed_envelope: e.envelope as unknown as Record<string, unknown>,
      source_receipt: (await ctx.ledger.getReceipt(e.sequence)) as unknown as Record<
        string,
        unknown
      >,
    })),
  );

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
}

/** Validates a bundle against its schema, throwing badRequest if malformed. */
export function validateBundleSchema(body: unknown): asserts body is SignedBundle {
  const result = validateAgainst(SCHEMA_IDS.bundle, body);
  if (!result.valid) {
    throw badRequest(
      'schema_invalid',
      'Request body is not a well-formed signed event bundle',
      JSON.stringify(result.errors),
    );
  }
}

/**
 * Imports every event in a (schema-already-validated) bundle, one at a
 * time: bootstraps trust from any embedded Key artifact first, appends
 * with allowPartialImport so cross-ledger causal gaps are represented as
 * explicit boundaries rather than hard failures, and quarantines (rather
 * than drops) anything that fails validation. Shared by the direct
 * /v1/bundles/import route and the peer-pull federation route so both
 * accept/quarantine identically.
 */
export async function importBundleEvents(
  ctx: LedgerContext,
  bundle: { events: BundleEvent[] },
): Promise<ImportSummary> {
  let accepted = 0;
  let duplicate = 0;
  const quarantined: string[] = [];

  for (const item of bundle.events) {
    try {
      const envelope = item.signed_envelope as unknown as SignedEnvelope;
      tryBootstrapKeyFromEvent(ctx, envelope as unknown as Record<string, unknown>);
      const result = await ctx.ledger.appendEvent(envelope, {
        publicKeys: ctx.keyRegistry.publicKeysByKeyId(),
        allowPartialImport: true,
        sourceReceipt: item.source_receipt as unknown as LedgerReceipt,
      });
      if (result.duplicate) duplicate++;
      else accepted++;
    } catch (err) {
      await ctx.ledger.quarantine(
        err instanceof Error ? err.message : 'unknown import failure',
        item.signed_envelope as unknown as SignedEnvelope,
      );
      quarantined.push(
        String((item.signed_envelope as { payloadDigest?: string }).payloadDigest ?? 'unknown'),
      );
    }
  }

  return { accepted, duplicate, quarantined };
}
