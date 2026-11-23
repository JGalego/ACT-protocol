import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

/**
 * Production OIDC/JWT bearer-token validation (PROMPT.md section 11 /
 * ACT-1.0.md section 11: "OIDC/OAuth 2.0 JWT validation for production
 * users and services"). This module only establishes *who is calling* --
 * it never grants ledger authority; see `plugins/auth.ts` and ADR 0006.
 */
export interface OidcConfig {
  /** Expected `iss` claim; also used to fetch `jwks_uri` via OIDC discovery when jwksUri is not given. */
  issuer: string;
  /** Expected `aud` claim. */
  audience: string;
  /** Overrides discovery; set this to skip the discovery-document fetch entirely. */
  jwksUri?: string | undefined;
  /** Claim carrying the ACT actor id. Defaults to the standard `sub` claim. */
  actorIdClaim?: string | undefined;
  /** Claim carrying the ACT tenant id. Defaults to `act_tenant`. */
  tenantClaim?: string | undefined;
}

export interface VerifiedCaller {
  actorId: string;
  /** Absent when the token carries no tenant claim; the caller decides whether that is acceptable. */
  tenantId: string | undefined;
}

interface DiscoveryDocument {
  jwks_uri?: string;
}

const jwksCache = new Map<string, JWTVerifyGetKey>();
const discoveryCache = new Map<string, Promise<string>>();

async function discoverJwksUri(issuer: string): Promise<string> {
  let cached = discoveryCache.get(issuer);
  if (!cached) {
    cached = (async () => {
      // OIDC Discovery 4: the document lives at `<issuer>/.well-known/openid-configuration`,
      // appended to the issuer *including its path* (an absolute-path URL would drop it).
      const discoveryUrl = new URL(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`);
      const response = await fetch(discoveryUrl);
      if (!response.ok) {
        throw new Error(
          `OIDC discovery document fetch failed for issuer "${issuer}" (HTTP ${response.status})`,
        );
      }
      const doc = (await response.json()) as DiscoveryDocument;
      if (!doc.jwks_uri) {
        throw new Error(`OIDC discovery document for issuer "${issuer}" is missing "jwks_uri"`);
      }
      return doc.jwks_uri;
    })();
    discoveryCache.set(issuer, cached);
    // Do not cache a failure: one provider hiccup at first use must not
    // disable authentication until the process restarts.
    cached.catch(() => {
      if (discoveryCache.get(issuer) === cached) discoveryCache.delete(issuer);
    });
  }
  return cached;
}

async function getJwks(config: OidcConfig): Promise<JWTVerifyGetKey> {
  const jwksUri = config.jwksUri ?? (await discoverJwksUri(config.issuer));
  let jwks = jwksCache.get(jwksUri);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUri));
    jwksCache.set(jwksUri, jwks);
  }
  return jwks;
}

/**
 * Verifies a bearer token's signature, issuer, audience, and expiry against
 * the configured OIDC provider, then extracts the ACT actor id and tenant id
 * from its claims. Throws on any validation failure; callers should map
 * that to an RFC 9457 401 response without leaking the underlying `jose`
 * error message verbatim to the client.
 */
export async function verifyOidcBearerToken(
  token: string,
  config: OidcConfig,
): Promise<VerifiedCaller> {
  const jwks = await getJwks(config);
  const { payload } = await jwtVerify(token, jwks, {
    issuer: config.issuer,
    audience: config.audience,
  });

  const actorIdClaim = config.actorIdClaim ?? 'sub';
  const actorId = payload[actorIdClaim];
  if (typeof actorId !== 'string' || !actorId) {
    throw new Error(`OIDC token is missing a non-empty "${actorIdClaim}" claim`);
  }

  const tenantClaim = config.tenantClaim ?? 'act_tenant';
  const tenantClaimValue = payload[tenantClaim];
  const tenantId =
    typeof tenantClaimValue === 'string' && tenantClaimValue ? tenantClaimValue : undefined;

  return { actorId, tenantId };
}
