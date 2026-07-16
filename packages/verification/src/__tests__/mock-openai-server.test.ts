import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { startMockOpenAiServer } from '../semantic/mock-openai-server.js';

describe('startMockOpenAiServer', () => {
  let server: Server;
  let url: string;

  beforeEach(async () => {
    const started = await startMockOpenAiServer();
    server = started.server;
    url = started.url;
  });

  afterEach(() => {
    server.close();
  });

  it('returns 404 for a GET request', async () => {
    const response = await fetch(`${url}/chat/completions`, { method: 'GET' });
    expect(response.status).toBe(404);
  });

  it('returns 404 for an unrecognized path', async () => {
    const response = await fetch(`${url}/not-chat-completions`, { method: 'POST', body: '{}' });
    expect(response.status).toBe(404);
  });

  it('returns 400 for a malformed JSON body', async () => {
    const response = await fetch(`${url}/chat/completions`, { method: 'POST', body: 'not json' });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBeTruthy();
  });
});
