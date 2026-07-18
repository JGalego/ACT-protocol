import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { SqliteAdapter } from '@act/ledger';
import { buildServer } from '../server.js';
import { createLedgerContext } from '../ledger-context.js';

describe('health, readiness, and metrics endpoints', () => {
  let server: FastifyInstance;

  afterEach(async () => {
    await server.close();
  });

  it('answers readiness with a real ledger read, not a hardcoded 200', async () => {
    server = await buildServer({
      devMode: true,
      ledgerContext: await createLedgerContext(':memory:'),
    });
    const response = await server.inject({ method: 'GET', url: '/v1/health/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('reports 503 when the storage backend is unreachable', async () => {
    const adapter = SqliteAdapter.open(':memory:');
    const ctx = await createLedgerContext(':memory:', { adapter });
    server = await buildServer({ devMode: true, ledgerContext: ctx });
    await adapter.close();

    const response = await server.inject({ method: 'GET', url: '/v1/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json().status).toBe('unavailable');
  });

  it('exposes Prometheus-format metrics without authentication', async () => {
    server = await buildServer({
      devMode: true,
      ledgerContext: await createLedgerContext(':memory:'),
    });
    const response = await server.inject({ method: 'GET', url: '/v1/metrics' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toContain('act_process_uptime_seconds');
    expect(response.body).toContain('act_nodejs_memory_rss_bytes');
  });
});
