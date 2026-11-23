import { digestCanonicalValue, SCHEMA_IDS, validateAgainst } from '@act/core';
import { signBytes, type SignedEnvelope } from '@act/crypto';
import {
  computeKnownGaps,
  gapsByReferencingEvent,
  sourceReceiptProblem,
  verifyBundleIntegrity,
  type LedgerReceipt,
  type StoredEvent,
} from '@act/ledger';
import type { LedgerContext } from './ledger-context.js';
import { evaluateKeyEvent } from './key-registry.js';
import type { PeerConfig } from './peer-registry.js';
import { ApiProblemError, badRequest } from './problem.js';
import { validateEventBody } from './routes/shared.js';
import { validateArtifactIntegrity } from './semantics.js';

export interface BundleEvent {
  signed_envelope: Record<string, unknown>;
  source_receipt: Record<string, unknown>;
}

export interface KnownGap {
  missing_event_id: string;
  referenced_by: string;
}

export interface SignedBundle {
  bundle_id: string;
  source_ledger_id: string;
  exported_at: string;
  events: BundleEvent[];
  completeness: { scope: 'complete' | 'partial'; description?: string; known_gaps: KnownGap[] };
  signature: { key_id: string; algorithm: 'ed25519'; signature: string };
}

export interface ImportSummary {
  accepted: number;
  duplicate: number;
  quarantined: string[];
}

const PAGE = 1000;

async function allEvents(ctx: LedgerContext): Promise<StoredEvent[]> {
  const out: StoredEvent[] = [];
  let after = -1;
  for (;;) {
    const page = await ctx.ledger.listEvents(PAGE, after);
    out.push(...page);
    if (page.length < PAGE) return out;
    after = page[page.length - 1]!.sequence;
  }
}

/**
 * Builds and signs an export bundle of this ledger's own events
 * (spec/federation.md section 2). Completeness is computed, not asserted: a
 * bundle is `complete` only if every causal parent of every included event is
 * itself included; otherwise it is `partial` and each gap is listed so the
 * importer can represent the missing-parent boundary honestly.
 */
export async function buildExportBundle(
  ctx: LedgerContext,
  artifactIds?: string[],
): Promise<SignedBundle> {
  const filtered = artifactIds !== undefined && artifactIds.length > 0;
  let events: StoredEvent[];
  if (filtered) {
    const byId = new Map<string, StoredEvent>();
    for (const id of artifactIds) {
      for (const e of await ctx.ledger.listEventsForArtifact(id)) byId.set(e.eventId, e);
    }
    events = [...byId.values()].sort((a, b) => a.sequence - b.sequence);
  } else {
    events = await allEvents(ctx);
  }

  const knownGaps: KnownGap[] = computeKnownGaps(
    events.map((e) => ({
      eventId: e.eventId,
      parentEventIds: (
        (e.envelope.payload as { causal_parents?: { event_id: string }[] }).causal_parents ?? []
      ).map((p) => p.event_id),
    })),
  );

  const bundleEvents: BundleEvent[] = [];
  for (const e of events) {
    const receipt = await ctx.ledger.getReceipt(e.sequence);
    if (!receipt) throw new Error(`Invariant violated: accepted event ${e.eventId} has no receipt`);
    bundleEvents.push({
      signed_envelope: e.envelope as unknown as Record<string, unknown>,
      source_receipt: receipt as unknown as Record<string, unknown>,
    });
  }

  const bundleBody = {
    source_ledger_id: ctx.ledgerId,
    exported_at: new Date().toISOString(),
    events: bundleEvents,
    completeness: {
      scope: filtered || knownGaps.length > 0 ? ('partial' as const) : ('complete' as const),
      ...(filtered ? { description: 'Export restricted to the requested artifact ids' } : {}),
      known_gaps: knownGaps,
    },
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
 * Spec/federation.md section 3 step 1 (bundle level): the bundle must name a
 * ledger this operator has registered as a peer, its id must be the digest of
 * its own body, and it must be signed by the key pinned for that peer. A
 * bundle that fails any of these is rejected whole -- nothing in it is read.
 */
export async function verifyBundle(ctx: LedgerContext, bundle: SignedBundle): Promise<PeerConfig> {
  const peer = await ctx.peerRegistry.findByLedgerId(bundle.source_ledger_id);
  if (!peer) {
    throw new ApiProblemError(
      403,
      'untrusted_source_ledger',
      `Ledger ${bundle.source_ledger_id} is not a registered federation peer`,
      'Register the peer, pinning its ledger id and signing key, before importing from it.',
    );
  }
  const check = verifyBundleIntegrity(bundle, {
    keyId: peer.ledgerKeyId,
    publicKey: peer.ledgerPublicKey,
  });
  if (!check.ok) {
    if (check.code === 'bundle_digest_mismatch') throw badRequest(check.code, check.message);
    throw new ApiProblemError(403, check.code, check.message);
  }
  return peer;
}

/**
 * Imports a bundle (spec/federation.md section 3). The bundle itself is
 * verified first; then each event individually: its source receipt, its body
 * and artifact integrity, and the full write path. Anything that fails is
 * quarantined with a reason rather than dropped. A causal parent that is not
 * in the destination is tolerated only if the bundle declares it in
 * `known_gaps` against that event.
 *
 * Trust: a self-signed Key event inside a verified bundle from a registered
 * peer may introduce a new key, because the operator already trusts that peer
 * to speak for its own actors. Bundles from anyone else are refused outright.
 */
export async function importBundle(
  ctx: LedgerContext,
  bundle: SignedBundle,
): Promise<ImportSummary> {
  const peer = await verifyBundle(ctx, bundle);

  const gaps = gapsByReferencingEvent(bundle.completeness.known_gaps);

  let accepted = 0;
  let duplicate = 0;
  const quarantined: string[] = [];
  let previousReceipt: LedgerReceipt | null = null;

  for (const item of bundle.events) {
    const envelope = item.signed_envelope as unknown as SignedEnvelope;
    const receipt = item.source_receipt as unknown as LedgerReceipt;
    try {
      const problem = sourceReceiptProblem(receipt, previousReceipt, envelope, {
        ledgerId: peer.ledgerId,
        keyId: peer.ledgerKeyId,
        publicKey: peer.ledgerPublicKey,
      });
      if (problem) throw new Error(problem);

      await ctx.keyRegistry.catchUp(ctx.ledger);
      const event = envelope.payload as unknown as { event_type: string; payload: unknown };
      validateEventBody(event);

      const keyOutcome = evaluateKeyEvent(ctx.keyRegistry, envelope);
      if (keyOutcome.kind === 'reject')
        throw new Error(`${keyOutcome.code}: ${keyOutcome.message}`);
      const bootstrapped =
        keyOutcome.kind === 'register' ? { [keyOutcome.keyId]: keyOutcome.publicKey } : {};
      const publicKeys = { ...ctx.keyRegistry.publicKeysByKeyId(), ...bootstrapped };
      validateArtifactIntegrity(envelope, publicKeys);

      const result = await ctx.ledger.appendEvent(envelope, {
        publicKeys,
        permittedMissingParentIds: gaps.get(envelope.payloadDigest) ?? [],
        sourceReceipt: receipt,
        ...(keyOutcome.kind === 'register' ? { additionalTrustedKeyIds: [keyOutcome.keyId] } : {}),
      });
      await ctx.keyRegistry.catchUp(ctx.ledger);
      if (result.duplicate) duplicate++;
      else accepted++;
      previousReceipt = receipt;
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
