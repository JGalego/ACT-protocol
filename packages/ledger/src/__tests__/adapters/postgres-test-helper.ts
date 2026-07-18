import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

export interface EmbeddedPostgresHandle {
  /** A connection string scoped (via the `search_path` GUC) to a single isolated schema. */
  makeConnectionString(schema: string): string;
  createSchema(schema: string): Promise<void>;
  dropSchema(schema: string): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Starts a real, locally-run PostgreSQL server for integration tests --
 * no Docker or system Postgres install required. `embedded-postgres`
 * downloads a statically-linked `postgres` binary on first use and runs it
 * as the current user against a throwaway data directory.
 */
export async function startEmbeddedPostgres(): Promise<EmbeddedPostgresHandle> {
  const dataDir = mkdtempSync(join(tmpdir(), 'act-pg-'));
  const port = await findFreePort();
  const server = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'act',
    password: 'act',
    port,
    persistent: false,
  });
  await server.initialise();
  await server.start();
  await server.createDatabase('act_ledger_test');

  const adminPool = new pg.Pool({
    connectionString: `postgres://act:act@127.0.0.1:${port}/act_ledger_test`,
  });

  return {
    makeConnectionString(schema: string) {
      return `postgres://act:act@127.0.0.1:${port}/act_ledger_test?options=-c%20search_path%3D${schema}`;
    },
    async createSchema(schema: string) {
      await adminPool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    },
    async dropSchema(schema: string) {
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    },
    async stop() {
      await adminPool.end();
      await server.stop();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
