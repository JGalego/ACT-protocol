import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { unauthorized } from '../problem.js';

declare module 'fastify' {
  interface FastifyRequest {
    tenantId: string;
    callerActorId: string;
  }
}

export interface AuthPluginOptions {
  /**
   * Enables the local development bearer scheme, where the bearer token is
   * taken directly as the caller's actor id, with no cryptographic proof.
   * MUST be false in production; see docs/security-and-privacy-guide.md.
   * Every protected write endpoint additionally requires the submitted
   * event envelope itself to carry a valid Ed25519 signature from a
   * registered key -- this header only establishes the caller's identity
   * for tenant scoping, rate limiting, and audit correlation.
   */
  devMode: boolean;
}

/**
 * Authentication is deliberately kept separate from authorization
 * (ACT-1.0.md section 11 / "Identity, Authentication, and Authorization"):
 * this plugin only establishes *who is calling*. Whether that caller is
 * permitted to perform a given action is decided by trust-policy and
 * policy-evaluation checks in the ledger and policy packages, never here.
 */
const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (fastify, options) => {
  fastify.decorateRequest('tenantId', '');
  fastify.decorateRequest('callerActorId', '');

  fastify.addHook('onRequest', async (request) => {
    if (request.url.startsWith('/v1/health') || request.url === '/v1/schemas') return;

    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw unauthorized('Missing or malformed Authorization header (expected: Bearer <token>)');
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      throw unauthorized('Empty bearer token');
    }

    if (!options.devMode) {
      throw unauthorized(
        'Production mode requires OIDC-validated bearer tokens, which are not yet implemented in this release candidate (see docs/roadmap.md). Set ACT_DEV_MODE=true only for local/embedded, non-production use.',
      );
    }

    request.callerActorId = token;
    request.tenantId = (request.headers['x-act-tenant'] as string | undefined) ?? 'default';
  });
};

export default fp(authPlugin, { name: 'act-auth' });
