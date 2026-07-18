import type { FastifyPluginAsync } from 'fastify';
import type { LedgerContext } from '../ledger-context.js';
import { buildExportBundle, importBundleEvents, validateBundleSchema } from '../bundle-ops.js';

/**
 * Bundle export/import per spec/federation.md. Real peer-to-peer transport
 * (a ledger pulling/pushing directly to another independently-hosted
 * ledger over HTTP) lives in routes/federation.ts, which reuses the exact
 * same buildExportBundle/importBundleEvents functions as this route so the
 * two paths can never accept/quarantine differently.
 */
const bundleRoutes: FastifyPluginAsync<{ ctx: LedgerContext }> = async (fastify, { ctx }) => {
  fastify.post('/v1/bundles/export', async (request) => {
    const { artifactIds } = (request.body as { artifactIds?: string[] }) ?? {};
    return buildExportBundle(ctx, artifactIds);
  });

  fastify.post('/v1/bundles/import', async (request) => {
    validateBundleSchema(request.body);
    return importBundleEvents(ctx, request.body);
  });

  fastify.get('/v1/quarantine', async () => ({ items: await ctx.ledger.listQuarantine() }));
};

export default bundleRoutes;
