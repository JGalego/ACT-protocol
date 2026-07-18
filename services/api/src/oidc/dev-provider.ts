import { createServer, type Server } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

/**
 * A deterministic, offline local OIDC provider, so the production OIDC/JWT
 * verification path (`jwt-verifier.ts`) is usable and testable without a
 * paid external identity provider (PROMPT.md's Execution Directive: "a
 * configurable external integration is acceptable only when the repository
 * also includes a deterministic local implementation or emulator"; and
 * separately, "a clearly marked local development identity provider that is
 * disabled in production mode").
 *
 * Serves real OIDC discovery, JWKS, and token-issuance endpoints over HTTP.
 * `POST /token` mints a signed ID token for whatever `sub`/`aud`/claims the
 * caller asks for -- there is no real login flow, credential check, or user
 * store, because this exists to exercise the verifier's contract (signature,
 * issuer, audience, expiry, claim mapping), not to emulate a real identity
 * provider's authentication UX.
 */
export interface DevOidcProvider {
  server: Server;
  /** Issuer base URL, e.g. http://127.0.0.1:PORT -- use as ACT_OIDC_ISSUER. */
  url: string;
  close(): Promise<void>;
}

export interface MintTokenRequest {
  sub: string;
  aud: string;
  tenant?: string;
  claims?: Record<string, unknown>;
  expiresInSeconds?: number;
}

export async function startDevOidcProvider(port = 0): Promise<DevOidcProvider> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const kid = 'dev-oidc-key-1';
  const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };

  let issuerUrl = '';

  const server = createServer((req, res) => {
    const url = req.url ?? '';

    if (req.method === 'GET' && url === '/.well-known/openid-configuration') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          issuer: issuerUrl,
          jwks_uri: `${issuerUrl}/jwks.json`,
          token_endpoint: `${issuerUrl}/token`,
          response_types_supported: ['token'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
        }),
      );
      return;
    }

    if (req.method === 'GET' && url === '/jwks.json') {
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }

    if (req.method === 'POST' && url === '/token') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        void (async () => {
          try {
            const parsed = JSON.parse(body || '{}') as MintTokenRequest;
            if (!parsed.sub || !parsed.aud) {
              res
                .writeHead(400, { 'content-type': 'application/json' })
                .end(JSON.stringify({ error: '"sub" and "aud" are required' }));
              return;
            }
            const token = await new SignJWT({
              act_tenant: parsed.tenant ?? 'default',
              ...(parsed.claims ?? {}),
            })
              .setProtectedHeader({ alg: 'RS256', kid })
              .setSubject(parsed.sub)
              .setIssuer(issuerUrl)
              .setAudience(parsed.aud)
              .setIssuedAt()
              .setExpirationTime(`${parsed.expiresInSeconds ?? 3600}s`)
              .sign(privateKey);
            res.writeHead(200, { 'content-type': 'application/json' }).end(
              JSON.stringify({
                access_token: token,
                token_type: 'Bearer',
                expires_in: parsed.expiresInSeconds ?? 3600,
              }),
            );
          } catch (err) {
            res
              .writeHead(400, { 'content-type': 'application/json' })
              .end(JSON.stringify({ error: err instanceof Error ? err.message : 'bad request' }));
          }
        })();
      });
      return;
    }

    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  issuerUrl = `http://127.0.0.1:${actualPort}`;

  return {
    server,
    url: issuerUrl,
    close: () =>
      new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const port = process.env.PORT ? Number(process.env.PORT) : 8081;
  startDevOidcProvider(port).then((provider) => {
    console.log(`ACT dev OIDC provider listening at ${provider.url}`);
    console.log(`  discovery: ${provider.url}/.well-known/openid-configuration`);
    console.log(`  jwks:      ${provider.url}/jwks.json`);
    console.log(`  token:     POST ${provider.url}/token  { "sub": "...", "aud": "..." }`);
  });
}
