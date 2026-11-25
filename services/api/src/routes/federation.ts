import type { FastifyPluginAsync } from 'fastify';
import { keyIdMatchesPublicKey } from '@act/crypto';
import type { LedgerContext } from '../ledger-context.js';
import { toPublicPeer, type PeerConfig } from '../peer-registry.js';
import { buildExportBundle, importBundle, validateBundleSchema } from '../bundle-ops.js';
import { assertPeerUrlAcceptable, assertResolvesPublic } from '../net-guard.js';
import { badGateway, badRequest, notFound } from '../problem.js';
import { assertAdmin } from './shared.js';

const PEER_TIMEOUT_MS = 15_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function authHeader(peer: PeerConfig): Record<string, string> {
  return peer.bearerToken ? { authorization: `Bearer ${peer.bearerToken}` } : {};
}

/**
 * Wraps `fetch` so an unreachable peer (connection refused, DNS failure,
 * timeout) surfaces as the same 502 problem as a non-2xx response. Redirects
 * are refused (a peer must not bounce this server at an internal address) and
 * the target is re-resolved and checked immediately before the call.
 */
async function fetchPeer(
  ctx: LedgerContext,
  url: string,
  init: RequestInit,
  action: string,
): Promise<Response> {
  await assertResolvesPublic(url, ctx.policy.allowPrivatePeers);
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(PEER_TIMEOUT_MS),
    });
  } catch (err) {
    throw badGateway(
      'peer_unreachable',
      action,
      err instanceof Error ? err.message : 'unknown network failure',
    );
  }
  if (!res.ok) {
    throw badGateway('peer_unreachable', action, await res.text().catch(() => undefined));
  }
  return res;
}

/**
 * Administrator-only HTTP bundle pull/push (spec/federation.md). Peer
 * registration pins the ledger id and signing key; imports verify that pin
 * and use appendEvent. Responses must not expose peer bearer tokens.
 */
const federationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/v1/federation/peers', async (request, reply) => {
    const ctx = request.ctx;
    assertAdmin(ctx, request);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const { url, label, bearerToken, ledgerId, ledgerKeyId, ledgerPublicKey } = body as {
      url?: string;
      label?: string;
      bearerToken?: string;
      ledgerId?: string;
      ledgerKeyId?: string;
      ledgerPublicKey?: string;
    };
    if (!url) throw badRequest('schema_invalid', 'url is required');
    if (!ledgerId || !UUID.test(ledgerId)) {
      throw badRequest(
        'schema_invalid',
        'ledgerId (the peer ledger UUID, from its GET /v1/ledger) is required',
      );
    }
    if (!ledgerKeyId || !ledgerPublicKey || !keyIdMatchesPublicKey(ledgerKeyId, ledgerPublicKey)) {
      throw badRequest(
        'schema_invalid',
        'ledgerKeyId and ledgerPublicKey (from the peer GET /v1/ledger) are required, and ledgerKeyId must be the fingerprint of ledgerPublicKey',
      );
    }
    const normalizedUrl = assertPeerUrlAcceptable(url, ctx.policy.allowPrivatePeers);
    const peer = await ctx.peerRegistry.register({
      url: normalizedUrl,
      ledgerId,
      ledgerKeyId,
      ledgerPublicKey,
      ...(label !== undefined ? { label } : {}),
      ...(bearerToken !== undefined ? { bearerToken } : {}),
    });
    reply.code(201);
    return toPublicPeer(peer);
  });

  fastify.get('/v1/federation/peers', async (request) => {
    const ctx = request.ctx;
    assertAdmin(ctx, request);
    return { items: (await ctx.peerRegistry.list()).map(toPublicPeer) };
  });

  fastify.delete('/v1/federation/peers/:peerId', async (request) => {
    const ctx = request.ctx;
    assertAdmin(ctx, request);
    const { peerId } = request.params as { peerId: string };
    if (!(await ctx.peerRegistry.remove(peerId))) throw notFound(`No registered peer ${peerId}`);
    return { removed: true };
  });

  fastify.post('/v1/federation/pull', async (request) => {
    const ctx = request.ctx;
    assertAdmin(ctx, request);
    const { peerId, artifactIds } = request.body as { peerId: string; artifactIds?: string[] };
    const peer = await ctx.peerRegistry.get(peerId);
    if (!peer) throw notFound(`No registered peer ${peerId}`);

    const res = await fetchPeer(
      ctx,
      `${peer.url}/v1/bundles/export`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader(peer) },
        body: JSON.stringify({ artifactIds }),
      },
      `Export from peer ${peerId} failed`,
    );
    const bundle: unknown = await res.json();
    validateBundleSchema(bundle);
    const summary = await importBundle(ctx, bundle);

    // Surfaced as distinct finding classes, never a hard reject
    // (spec/federation.md section 6): forks are legitimate branches, only
    // equivocation is adversarial.
    const forks = await ctx.ledger.findForks();
    const equivocations = await ctx.ledger.findEquivocations();

    return { peerId, ...summary, findings: { forks, equivocations } };
  });

  fastify.post('/v1/federation/push', async (request) => {
    const ctx = request.ctx;
    assertAdmin(ctx, request);
    const { peerId, artifactIds } = request.body as { peerId: string; artifactIds?: string[] };
    const peer = await ctx.peerRegistry.get(peerId);
    if (!peer) throw notFound(`No registered peer ${peerId}`);

    const bundle = await buildExportBundle(ctx, artifactIds);
    const res = await fetchPeer(
      ctx,
      `${peer.url}/v1/bundles/import`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader(peer) },
        body: JSON.stringify(bundle),
      },
      `Import to peer ${peerId} failed`,
    );
    return res.json();
  });
};

export default federationRoutes;
