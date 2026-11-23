import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type { LedgerContext, TenantRegistry } from '../ledger-context.js';
import { isPublicRoute } from './auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The authenticated caller's tenant's ledger. Every handler works through this and nothing else. */
    ctx: LedgerContext;
  }
}

/**
 * Resolves the caller's tenant (established by the auth plugin) to that
 * tenant's ledger context before any route runs. Registered after the auth
 * plugin, so its hook runs after authentication. There is deliberately no way
 * for a handler to ask for another tenant's context: the only context in
 * reach is `request.ctx`.
 */
const tenantPlugin: FastifyPluginAsync<{ registry: TenantRegistry }> = async (
  fastify,
  { registry },
) => {
  fastify.decorateRequest('ctx', null as unknown as LedgerContext);

  fastify.addHook('onRequest', async (request) => {
    if (isPublicRoute(request.url)) return;
    request.ctx = await registry.get(request.tenantId);
  });
};

export default fp(tenantPlugin, { name: 'act-tenant', dependencies: ['act-auth'] });
