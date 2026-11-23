import type { FastifyPluginAsync } from 'fastify';
import { buildExportBundle, importBundle, validateBundleSchema } from '../bundle-ops.js';
import { assertAdmin } from './shared.js';

/**
 * Bundle export/import per spec/federation.md. Real peer-to-peer transport
 * lives in routes/federation.ts, which reuses the exact same
 * buildExportBundle/importBundle functions so the two paths can never
 * accept/quarantine differently. Importing writes foreign history into this
 * ledger and is an administrator operation.
 */
const bundleRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/v1/bundles/export', async (request) => {
    const ctx = request.ctx;
    const { artifactIds } = (request.body as { artifactIds?: string[] }) ?? {};
    return buildExportBundle(ctx, artifactIds);
  });

  fastify.post('/v1/bundles/import', async (request) => {
    const ctx = request.ctx;
    assertAdmin(ctx, request);
    validateBundleSchema(request.body);
    return importBundle(ctx, request.body);
  });

  fastify.get('/v1/quarantine', async (request) => {
    const ctx = request.ctx;
    assertAdmin(ctx, request);
    return { items: await ctx.ledger.listQuarantine() };
  });
};

export default bundleRoutes;
