import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startDevOidcProvider, type DevOidcProvider } from '../oidc/dev-provider.js';
import { buildServer } from '../server.js';
import { createLedgerContext } from '../ledger-context.js';

const AUDIENCE = 'act-api';

async function mintToken(
  provider: DevOidcProvider,
  body: { sub: string; aud?: string; tenant?: string; expiresInSeconds?: number },
): Promise<string> {
  const response = await fetch(`${provider.url}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ aud: AUDIENCE, ...body }),
  });
  expect(response.status).toBe(200);
  const { access_token } = (await response.json()) as { access_token: string };
  return access_token;
}

describe('production OIDC/JWT bearer-token validation', () => {
  let provider: DevOidcProvider;
  let server: FastifyInstance;

  beforeEach(async () => {
    provider = await startDevOidcProvider();
    server = await buildServer({
      devMode: false,
      nodeEnv: 'test',
      oidc: { issuer: provider.url, audience: AUDIENCE },
      ledgerContext: await createLedgerContext(':memory:'),
    });
  });

  afterEach(async () => {
    await server.close();
    await provider.close();
  });

  it("serves a real OIDC discovery document and JWKS at the provider's issuer URL", async () => {
    const discovery = await fetch(`${provider.url}/.well-known/openid-configuration`);
    expect(discovery.status).toBe(200);
    const doc = (await discovery.json()) as { issuer: string; jwks_uri: string };
    expect(doc.issuer).toBe(provider.url);

    const jwks = await fetch(doc.jwks_uri);
    expect(jwks.status).toBe(200);
    const { keys } = (await jwks.json()) as { keys: unknown[] };
    expect(keys).toHaveLength(1);
  });

  it('accepts a validly signed token and maps sub/act_tenant claims to callerActorId/tenantId', async () => {
    const token = await mintToken(provider, { sub: 'actor-oidc-1', tenant: 'acme-corp' });
    const response = await server.inject({
      method: 'GET',
      url: '/v1/events',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
  });

  it('defaults tenantId to "default" when the token carries no act_tenant claim', async () => {
    const token = await mintToken(provider, { sub: 'actor-oidc-2' });
    const response = await server.inject({
      method: 'GET',
      url: '/v1/events',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
  });

  it('rejects a token signed for a different audience', async () => {
    const token = await mintToken(provider, { sub: 'actor-oidc-3', aud: 'some-other-api' });
    const response = await server.inject({
      method: 'GET',
      url: '/v1/events',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects an expired token', async () => {
    const token = await mintToken(provider, { sub: 'actor-oidc-4', expiresInSeconds: -10 });
    const response = await server.inject({
      method: 'GET',
      url: '/v1/events',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a token from an untrusted issuer', async () => {
    const otherProvider = await startDevOidcProvider();
    try {
      const token = await mintToken(otherProvider, { sub: 'actor-oidc-5' });
      const response = await server.inject({
        method: 'GET',
        url: '/v1/events',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(401);
    } finally {
      await otherProvider.close();
    }
  });

  it('rejects a malformed bearer token without crashing the server', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/v1/events',
      headers: { authorization: 'Bearer not-a-real-jwt' },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('production fail-closed behavior', () => {
  it('refuses to build when ACT_DEV_MODE is enabled in production, even with OIDC also configured', async () => {
    const provider = await startDevOidcProvider();
    try {
      await expect(
        buildServer({
          devMode: true,
          nodeEnv: 'production',
          oidc: { issuer: provider.url, audience: AUDIENCE },
          ledgerContext: await createLedgerContext(':memory:'),
        }),
      ).rejects.toThrow(/ACT_DEV_MODE must not be enabled in production/);
    } finally {
      await provider.close();
    }
  });

  it('builds successfully in production mode when OIDC is configured and devMode is off', async () => {
    const provider = await startDevOidcProvider();
    try {
      const productionServer = await buildServer({
        devMode: false,
        nodeEnv: 'production',
        oidc: { issuer: provider.url, audience: AUDIENCE },
        ledgerContext: await createLedgerContext(':memory:'),
      });
      await productionServer.close();
    } finally {
      await provider.close();
    }
  });
});
