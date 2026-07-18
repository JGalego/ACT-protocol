import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateId } from '@act/core';
import { generateKeyPair } from '@act/crypto';
import { Ledger } from '../ledger.js';
import { PostgresAdapter } from '../postgres-adapter.js';
import { allowlistTrustPolicy } from '../types.js';
import {
  startEmbeddedPostgres,
  type EmbeddedPostgresHandle,
} from './adapters/postgres-test-helper.js';
import { registerLedgerSuite } from './shared/ledger-suite.js';
import type { StorageAdapter } from '../storage-adapter.js';
import { buildEvent, makeActor, publicKeysFor, signedEnvelope } from './helpers.js';

// Proves SqliteAdapter/PostgresAdapter behavioral equivalence against a
// real, locally-run PostgreSQL server (no Docker/root required -- see
// adapters/postgres-test-helper.ts). Opt-in: `pnpm --filter @act/ledger run
// test:integration`. Each test gets its own schema within one shared
// cluster/database so tests stay isolated without the cost of a fresh
// cluster per test.
let handle: EmbeddedPostgresHandle;
let schemaCounter = 0;

beforeAll(async () => {
  handle = await startEmbeddedPostgres();
}, 60_000);

afterAll(async () => {
  await handle.stop();
});

async function makePostgresAdapter(): Promise<PostgresAdapter> {
  const schema = `test_${Date.now()}_${schemaCounter++}`;
  await handle.createSchema(schema);
  const adapter = new PostgresAdapter(handle.makeConnectionString(schema));
  await adapter.migrate();
  return adapter;
}

registerLedgerSuite('postgres', makePostgresAdapter, async (adapter: StorageAdapter) => {
  await adapter.close();
});

describe('PostgresAdapter concurrency', () => {
  it('retries and assigns distinct sequential sequence numbers when appends genuinely race', async () => {
    const adapter = await makePostgresAdapter();
    const actor = makeActor();
    const ledgerKeyPair = generateKeyPair();
    const ledger = new Ledger({
      ledgerId: generateId(),
      adapter,
      signer: {
        keyId: ledgerKeyPair.keyId,
        publicKey: ledgerKeyPair.publicKey,
        privateKey: ledgerKeyPair.privateKey,
      },
      trustPolicy: allowlistTrustPolicy([actor.signer.keyId]),
    });

    const CONCURRENCY = 8;
    const envelopes = Array.from({ length: CONCURRENCY }, () =>
      signedEnvelope(
        buildEvent({
          actor,
          eventType: 'genesis',
          subject: { kind: 'artifact', artifact_id: generateId() },
        }),
        actor,
      ),
    );

    const results = await Promise.all(
      envelopes.map((envelope) =>
        ledger.appendEvent(envelope, { publicKeys: publicKeysFor(actor) }),
      ),
    );

    const sequences = results.map((r) => r.receipt.sequence).sort((a, b) => a - b);
    expect(sequences).toEqual(Array.from({ length: CONCURRENCY }, (_, i) => i));
    expect(new Set(results.map((r) => r.event.eventId)).size).toBe(CONCURRENCY);

    await adapter.close();
  });
});
