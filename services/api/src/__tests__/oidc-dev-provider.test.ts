import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startDevOidcProvider, type DevOidcProvider } from '../oidc/dev-provider.js';

describe('startDevOidcProvider', () => {
  let provider: DevOidcProvider;

  beforeEach(async () => {
    provider = await startDevOidcProvider();
  });

  afterEach(async () => {
    await provider.close();
  });

  it('returns 404 for an unrecognized path', async () => {
    const response = await fetch(`${provider.url}/not-a-real-endpoint`);
    expect(response.status).toBe(404);
  });

  it('returns 400 when /token is called without sub or aud', async () => {
    const response = await fetch(`${provider.url}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/sub.*aud/);
  });

  it('returns 400 for a malformed JSON body to /token', async () => {
    const response = await fetch(`${provider.url}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBeTruthy();
  });
});
