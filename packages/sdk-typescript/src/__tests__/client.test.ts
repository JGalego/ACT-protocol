import { describe, expect, it, vi } from 'vitest';
import { ActApiError, ActClient } from '../client.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('ActClient', () => {
  it('sends a GET request and returns the parsed JSON body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { hello: 'world' }));
    const client = new ActClient({ baseUrl: 'http://example.test', fetchImpl });
    const result = await client.getArtifact('art-1');
    expect(result).toEqual({ hello: 'world' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://example.test/v1/artifacts/art-1',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('sends a POST request with the envelope as the body and an idempotency key header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, { accepted: true }));
    const client = new ActClient({ baseUrl: 'http://example.test', fetchImpl });
    const envelope = {
      payloadType: 'x',
      payload: {},
      payloadDigest: 'sha-256:' + '0'.repeat(64),
      signatures: [],
    } as any;
    await client.submitIntent(envelope, 'idem-1');
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init.method).toBe('POST');
    expect(init.headers['idempotency-key']).toBe('idem-1');
    expect(JSON.parse(init.body)).toEqual(envelope);
  });

  it('includes a bearer token header when configured', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const client = new ActClient({
      baseUrl: 'http://example.test',
      bearerToken: 'tok-123',
      fetchImpl,
    });
    await client.health();
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init.headers.authorization).toBe('Bearer tok-123');
  });

  it('throws ActApiError with problem details on a 4xx response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(409, {
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        code: 'duplicate',
      }),
    );
    const client = new ActClient({ baseUrl: 'http://example.test', fetchImpl });
    await expect(client.getArtifact('art-1')).rejects.toMatchObject({
      status: 409,
      problem: { code: 'duplicate' },
    });
    await expect(client.getArtifact('art-1')).rejects.toBeInstanceOf(ActApiError);
  });

  it('retries a 5xx response and succeeds on a later attempt', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const client = new ActClient({ baseUrl: 'http://example.test', fetchImpl, retryDelayMs: 1 });
    const result = await client.health();
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries a network error and eventually throws after exhausting retries', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const client = new ActClient({
      baseUrl: 'http://example.test',
      fetchImpl,
      maxRetries: 1,
      retryDelayMs: 1,
    });
    await expect(client.health()).rejects.toThrow('ECONNREFUSED');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('returns undefined for a 204 No Content response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = new ActClient({ baseUrl: 'http://example.test', fetchImpl });
    await expect(client.health()).resolves.toBeUndefined();
  });

  it('falls back to a generic problem when the error body is not valid JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('not json', { status: 500 }));
    const client = new ActClient({ baseUrl: 'http://example.test', fetchImpl, maxRetries: 0 });
    await expect(client.health()).rejects.toMatchObject({ status: 500 });
  });

  it('passes query parameters for listEvents and getLineage', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse(200, { items: [], nextCursor: null })),
      );
    const client = new ActClient({ baseUrl: 'http://example.test', fetchImpl });
    await client.listEvents('cursor-1', 10);
    expect(fetchImpl.mock.calls[0]![0]).toContain('cursor=cursor-1');
    expect(fetchImpl.mock.calls[0]![0]).toContain('limit=10');

    await client.getLineage('event-1', 5);
    expect(fetchImpl.mock.calls[1]![0]).toContain('maxDepth=5');
  });

  it('exposes bundle export/import helpers', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(200, {})));
    const client = new ActClient({ baseUrl: 'http://example.test', fetchImpl });
    await client.exportBundle(['a1']);
    expect(JSON.parse(fetchImpl.mock.calls[0]![1].body)).toEqual({ artifactIds: ['a1'] });
    await client.importBundle({ bundle_id: 'x' });
    expect(JSON.parse(fetchImpl.mock.calls[1]![1].body)).toEqual({ bundle_id: 'x' });
  });

  it('exposes every write and read convenience method', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(200, { ok: true })));
    const client = new ActClient({ baseUrl: 'http://example.test', fetchImpl });
    const envelope = {
      payloadType: 'x',
      payload: {},
      payloadDigest: 'sha-256:' + '0'.repeat(64),
      signatures: [],
    } as any;

    await client.submitTransformation(envelope);
    await client.submitArtifact(envelope);
    await client.submitApprovalRequest(envelope);
    await client.submitApprovalDecision(envelope);
    await client.submitChallenge(envelope);
    await client.submitVerification(envelope);
    await client.registerActor(envelope);
    await client.registerKey(envelope);
    await client.publishPolicy(envelope);
    await client.getArtifactVersions('art-1');
    await client.getHistory('art-1');

    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual([
      'http://example.test/v1/transformations',
      'http://example.test/v1/artifacts',
      'http://example.test/v1/approval-requests',
      'http://example.test/v1/approval-decisions',
      'http://example.test/v1/challenges',
      'http://example.test/v1/verifications',
      'http://example.test/v1/actors',
      'http://example.test/v1/keys',
      'http://example.test/v1/policies',
      'http://example.test/v1/artifacts/art-1/versions',
      'http://example.test/v1/history/art-1',
    ]);
  });
});
