import { describe, expect, it } from 'vitest';
import { SqliteAdapter } from '../sqlite-adapter.js';
import { runMigrations, SQLITE_MIGRATIONS } from '../migrations.js';
import { registerMigrationSuite } from './shared/migration-suite.js';

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

    expect(await adapter.getEvent('L', 'sha-256:' + '1'.repeat(64))).toBeNull();
  });

  it('does not let a read outside a transaction see rows that transaction may yet roll back', async () => {
    // One connection, and a transaction spans awaits: a read issued meanwhile must wait for it
    // rather than run inside it, or it can report an event that never commits.
    const adapter = SqliteAdapter.open(':memory:');
    await adapter.migrate();
    const id = 'sha-256:' + '2'.repeat(64);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));

    const aborted = adapter
      .withTransaction(async (tx) => {
        await tx.insertEvent({
          event_id: id,
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
        await gate; // the transaction stays open here
        throw new Error('abort');
      })
      .catch(() => undefined);

    const read = adapter.getEvent('L', id); // issued while the transaction is open
    const write = adapter.setMeta('written-meanwhile', 'v'); // must not join the transaction either
    await new Promise((resolve) => setTimeout(resolve, 10));
    release();
    await aborted;

    expect(await read).toBeNull(); // the insert was rolled back; it must never have been visible
    await write;
    expect(await adapter.getMeta('written-meanwhile')).toBe('v'); // and the write was not rolled back with it
  });

  it('runMigrations is idempotent -- a second run against an already-migrated store applies nothing new', async () => {
    const adapter = SqliteAdapter.open(':memory:');
    await runMigrations(adapter, SQLITE_MIGRATIONS);
    await expect(runMigrations(adapter, SQLITE_MIGRATIONS)).resolves.toBeUndefined();
    expect(
      adapter.raw().prepare('SELECT 1 FROM schema_migrations WHERE id = ?').get('0001-init'),
    ).toBeDefined();
  });
});

registerMigrationSuite('sqlite', async () => SqliteAdapter.open(':memory:'), SQLITE_MIGRATIONS);
