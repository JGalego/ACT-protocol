import type { FastifyPluginAsync } from 'fastify';
import type { LedgerContext } from '../ledger-context.js';
import type { PeerConfig } from '../peer-registry.js';
import { buildExportBundle, importBundleEvents, tryBootstrapKeyFromEvent } from '../bundle-ops.js';
import type { SignedBundle } from '../bundle-ops.js';
import { badGateway, badRequest, notFound } from '../problem.js';

function authHeader(peer: PeerConfig): Record<string, string> {
  return peer.bearerToken ? { authorization: `Bearer ${peer.bearerToken}` } : {};
}

/** Wraps `fetch` so an unreachable peer (connection refused, DNS failure, timeout) surfaces as the same 502 problem as a non-2xx response, rather than an uncaught exception. */
async function fetchPeer(url: string, init: RequestInit, action: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
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
 * Real peer-to-peer federation transport (spec/federation.md): pulling a
 * bundle from, or pushing one to, an independently-hosted ACT ledger over
 * HTTP. Distinct from routes/bundles.ts's direct export/import (which
 * operates on a bundle already in hand); this route makes the network call
 * itself, then feeds the result through the exact same
 * buildExportBundle/importBundleEvents functions so both paths
 * accept/quarantine identically. Peer registration grants no trust by
 * itself -- pulled events still go through the full appendEvent write path.
 */
const federationRoutes: FastifyPluginAsync<{ ctx: LedgerContext }> = async (fastify, { ctx }) => {
  fastify.post('/v1/federation/peers', async (request, reply) => {
    const body = (request.body ?? {}) as {
      url?: string;
      label?: string;
      bearerToken?: string;
    };
    if (!body.url) throw badRequest('schema_invalid', 'url is required');
    reply.code(201);
    return ctx.peerRegistry.register({
      url: body.url,
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.bearerToken !== undefined ? { bearerToken: body.bearerToken } : {}),
    });
  });

  fastify.get('/v1/federation/peers', async () => ({ items: ctx.peerRegistry.list() }));

  fastify.delete('/v1/federation/peers/:peerId', async (request) => {
    const { peerId } = request.params as { peerId: string };
    if (!ctx.peerRegistry.remove(peerId)) throw notFound(`No registered peer ${peerId}`);
    return { removed: true };
  });

  fastify.post('/v1/federation/pull', async (request) => {
    const { peerId, artifactIds } = request.body as { peerId: string; artifactIds?: string[] };
    const peer = ctx.peerRegistry.get(peerId);
    if (!peer) throw notFound(`No registered peer ${peerId}`);

    const res = await fetchPeer(
      `${peer.url}/v1/bundles/export`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader(peer) },
        body: JSON.stringify({ artifactIds }),
      },
      `Export from peer ${peerId} failed`,
    );
    const bundle = (await res.json()) as SignedBundle;

    for (const item of bundle.events) {
      tryBootstrapKeyFromEvent(ctx, item.signed_envelope);
    }
    const summary = await importBundleEvents(ctx, bundle);

    // Surfaced as distinct finding classes, never a hard reject
    // (spec/federation.md section 6): forks are legitimate branches, only
    // equivocation is adversarial.
    const forks = await ctx.ledger.findForks();
    const equivocations = await ctx.ledger.findEquivocations();

    return { peerId, ...summary, findings: { forks, equivocations } };
  });

  fastify.post('/v1/federation/push', async (request) => {
    const { peerId, artifactIds } = request.body as { peerId: string; artifactIds?: string[] };
    const peer = ctx.peerRegistry.get(peerId);
    if (!peer) throw notFound(`No registered peer ${peerId}`);

    const bundle = await buildExportBundle(ctx, artifactIds);
    const res = await fetchPeer(
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
