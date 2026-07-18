import { describe, expect, it } from 'vitest';
import { SqliteAdapter } from '../sqlite-adapter.js';
import { runMigrations, SQLITE_MIGRATIONS } from '../migrations.js';

describe('SqliteAdapter', () => {
  it('close() releases the underlying database handle without throwing', async () => {
    const adapter = SqliteAdapter.open(':memory:');
    await adapter.migrate();
    await expect(adapter.close()).resolves.toBeUndefined();
  });

  it('withTransaction rolls back every write when fn throws partway through', async () => {
    const adapter = SqliteAdapter.open(':memory:');
    await adapter.migrate();

    await expect(
      adapter.withTransaction(async (tx) => {
        await tx.insertEvent({
          event_id: 'sha-256:' + '1'.repeat(64),
          ledger_id: 'L',
          sequence: 0,
          event_type: 'genesis',
          subject_kind: 'artifact',
          subject_artifact_id: 'A',
          subject_version_id: 'V',
          envelope_json: '{}',
          accepted_at: '2026-01-01T00:00:00Z',
          idempotency_key: null,
        });
        throw new Error('simulated failure after the insert');
      }),
    ).rejects.toThrow('simulated failure after the insert');

    expect(await adapter.getEvent('sha-256:' + '1'.repeat(64))).toBeNull();
  });

  it('runMigrations is idempotent -- a second run against an already-migrated store applies nothing new', async () => {
    const adapter = SqliteAdapter.open(':memory:');
    await runMigrations(adapter, SQLITE_MIGRATIONS);
    await expect(runMigrations(adapter, SQLITE_MIGRATIONS)).resolves.toBeUndefined();
    expect(await adapter.hasMigration('0001-init')).toBe(true);
  });
});
