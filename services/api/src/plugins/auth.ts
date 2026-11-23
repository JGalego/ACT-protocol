import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { badRequest, unauthorized } from '../problem.js';
import { DEFAULT_TENANT, isValidTenantId } from '../tenancy.js';
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
  /**
   * When true, a caller whose credentials name no tenant is refused instead of
   * being placed in the `default` tenant (ADR 0010). Recommended for any
   * deployment that serves more than one tenant; on by default in production.
   */
  requireTenant?: boolean | undefined;
}

/** Routes reachable without credentials: probes, the schema catalogue and metrics. */
export function isPublicRoute(url: string): boolean {
  return url.startsWith('/v1/health') || url === '/v1/schemas' || url === '/v1/metrics';
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
    if (isPublicRoute(request.url)) return;

    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw unauthorized('Missing or malformed Authorization header (expected: Bearer <token>)');
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      throw unauthorized('Empty bearer token');
    }

    // The tenant comes from credentials (a verified claim, or the dev header),
    // never from a request body, and is checked before it can name any storage.
    const resolveTenant = (claimed: string | undefined, source: string): string => {
      if (claimed === undefined || claimed === '') {
        if (options.requireTenant) {
          throw unauthorized(`This server requires every caller to name a tenant (${source})`);
        }
        return DEFAULT_TENANT;
      }
      if (!isValidTenantId(claimed)) {
        throw badRequest(
          'invalid_tenant',
          'The tenant id is not valid',
          'Tenant ids are 1-64 characters: letters, digits, ".", "_" and "-", starting with a letter or digit',
        );
      }
      return claimed;
    };

    if (options.devMode) {
      request.callerActorId = token;
      const header = request.headers['x-act-tenant'];
      request.tenantId = resolveTenant(
        Array.isArray(header) ? header[0] : header,
        'x-act-tenant header',
      );
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
      request.tenantId = resolveTenant(verified.tenantId, 'tenant claim');
      return;
    }

    throw unauthorized(
      'Production mode requires either OIDC configuration (ACT_OIDC_ISSUER and ACT_OIDC_AUDIENCE) or the local development bearer scheme (ACT_DEV_MODE=true, non-production only).',
    );
  });
};

export default fp(authPlugin, { name: 'act-auth' });
