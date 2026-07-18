import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { unauthorized } from '../problem.js';
import { verifyOidcBearerToken, type OidcConfig } from '../oidc/jwt-verifier.js';

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
  /**
   * Production OIDC/JWT validation (ADR 0006 amendment). When set, bearer
   * tokens are verified as real OIDC-issued JWTs -- signature, issuer,
   * audience, and expiry -- via `oidc/jwt-verifier.ts`. Mutually exclusive
   * with `devMode` in practice (`server.ts` refuses to combine them in
   * production), but the plugin itself just prefers devMode when both are
   * somehow set, so tests can build a devMode server without stripping this.
   */
  oidc?: OidcConfig | undefined;
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
    if (
      request.url.startsWith('/v1/health') ||
      request.url === '/v1/schemas' ||
      request.url === '/v1/metrics'
    )
      return;

    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw unauthorized('Missing or malformed Authorization header (expected: Bearer <token>)');
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      throw unauthorized('Empty bearer token');
    }

    if (options.devMode) {
      request.callerActorId = token;
      request.tenantId = (request.headers['x-act-tenant'] as string | undefined) ?? 'default';
      return;
    }

    if (options.oidc) {
      let verified;
      try {
        verified = await verifyOidcBearerToken(token, options.oidc);
      } catch (err) {
        throw unauthorized(
          `OIDC bearer token validation failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        );
      }
      request.callerActorId = verified.actorId;
      request.tenantId = verified.tenantId;
      return;
    }

    throw unauthorized(
      'Production mode requires either OIDC configuration (ACT_OIDC_ISSUER and ACT_OIDC_AUDIENCE) or the local development bearer scheme (ACT_DEV_MODE=true, non-production only).',
    );
  });
};

export default fp(authPlugin, { name: 'act-auth' });
