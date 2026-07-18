import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { startDevOidcProvider, type DevOidcProvider } from '../oidc/dev-provider.js';
import { verifyOidcBearerToken } from '../oidc/jwt-verifier.js';

const AUDIENCE = 'act-api';

function startStaticServer(handler: (url: string) => { status: number; body: string }): Promise<{
  server: Server;
  url: string;
}> {
  const server = createServer((req, res) => {
    const { status, body } = handler(req.url ?? '');
    res.writeHead(status, { 'content-type': 'application/json' }).end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

async function mintToken(provider: DevOidcProvider, sub: string): Promise<string> {
  const response = await fetch(`${provider.url}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sub, aud: AUDIENCE }),
  });
  const { access_token } = (await response.json()) as { access_token: string };
  return access_token;
}

describe('verifyOidcBearerToken discovery failures', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) await new Promise((resolve) => server!.close(resolve));
    server = undefined;
  });

  it('throws when the discovery document fetch is not ok', async () => {
    const started = await startStaticServer(() => ({ status: 500, body: '{}' }));
    server = started.server;
    await expect(
      verifyOidcBearerToken('irrelevant', { issuer: started.url, audience: AUDIENCE }),
    ).rejects.toThrow(/discovery document fetch failed/);
  });

  it('throws when the discovery document is missing jwks_uri', async () => {
    const started = await startStaticServer(() => ({ status: 200, body: '{}' }));
    server = started.server;
    await expect(
      verifyOidcBearerToken('irrelevant', { issuer: started.url, audience: AUDIENCE }),
    ).rejects.toThrow(/missing "jwks_uri"/);
  });
});

describe('verifyOidcBearerToken claim mapping', () => {
  let provider: DevOidcProvider;

  afterEach(async () => {
    if (provider) await provider.close();
  });

  it('throws when the token is missing the configured actorIdClaim', async () => {
    provider = await startDevOidcProvider();
    const token = await mintToken(provider, 'actor-claim-test');
    await expect(
      verifyOidcBearerToken(token, {
        issuer: provider.url,
        audience: AUDIENCE,
        actorIdClaim: 'employee_id',
      }),
    ).rejects.toThrow(/missing a non-empty "employee_id" claim/);
  });
});
