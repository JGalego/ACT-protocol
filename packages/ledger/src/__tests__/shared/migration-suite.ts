import { describe, expect, it } from 'vitest';
import type { Migration } from '../../migrations.js';
import { runMigrations } from '../../migrations.js';
import type { StorageAdapter } from '../../storage-adapter.js';

/**
 * A database written before tenant scoping holds one ledger whose rows have
 * no ledger column on edges, heads or quarantine. Migration 0003 must carry
 * every row into that ledger and re-key the tables, on every engine.
 */
export function registerMigrationSuite(
  dialectName: string,
  makeBareAdapter: () => Promise<StorageAdapter>,
  migrations: readonly Migration[],
  cleanup?: (adapter: StorageAdapter) => Promise<void>,
): void {
  describe(`migration 0003-tenant-scoping [${dialectName}]`, () => {
    it('moves a pre-tenancy database into the ledger that wrote it', async () => {
      const adapter = await makeBareAdapter();
      try {
        const legacy = migrations.filter((m) => m.id < '0003');
        await runMigrations(adapter, legacy);
        await adapter.exec(`
          INSERT INTO events (event_id, ledger_id, sequence, event_type, subject_kind, subject_artifact_id, subject_version_id, envelope_json, accepted_at, idempotency_key)
            VALUES ('e0', 'L1', 0, 'genesis', 'artifact', 'A', 'V', '{}', '2026-01-01T00:00:00Z', 'idem-0'),
                   ('e1', 'L1', 1, 'artifact_revised', 'artifact', 'A', 'V2', '{}', '2026-01-01T00:00:01Z', NULL);
          INSERT INTO causal_parents (event_id, parent_event_id, relation, is_missing)
            VALUES ('e1', 'e0', 'revision-of', 0), ('e1', 'gone', 'input', 1);
          INSERT INTO heads (artifact_id, version_id, event_id, updated_at)
            VALUES ('A', 'V2', 'e1', '2026-01-01T00:00:01Z');
          INSERT INTO quarantine (id, reason, envelope_json, quarantined_at)
            VALUES ('L1:123:abc', 'bad', '{}', '2026-01-01T00:00:02Z');
        `);

        await runMigrations(adapter, migrations);

        expect((await adapter.getEvent('L1', 'e1'))?.sequence).toBe(1);
        expect((await adapter.findByIdempotencyKey('L1', 'idem-0'))?.event_id).toBe('e0');
        expect(
          (await adapter.getCausalParentsFor('L1', 'e1')).map((p) => p.parent_event_id).sort(),
        ).toEqual(['e0', 'gone']);
        expect((await adapter.getChildrenOf('L1', 'e0')).map((p) => p.event_id)).toEqual(['e1']);
        expect((await adapter.getHead('L1', 'A'))?.version_id).toBe('V2');
        expect((await adapter.listQuarantine('L1')).map((q) => q.id)).toEqual(['L1:123:abc']);

        // Nothing is visible from any other ledger.
        expect(await adapter.getEvent('L2', 'e1')).toBeNull();
        expect(await adapter.getAllCausalParents('L2')).toEqual([]);
        expect(await adapter.getHead('L2', 'A')).toBeNull();
        expect(await adapter.listQuarantine('L2')).toEqual([]);

        // The old global keys are gone: the same event id may now live in another ledger.
        await adapter.withTransaction(async (tx) => {
          await tx.insertEvent({
            event_id: 'e0',
            ledger_id: 'L2',
            sequence: 0,
            event_type: 'genesis',
            subject_kind: 'artifact',
            subject_artifact_id: 'A',
            subject_version_id: 'V',
            envelope_json: '{}',
            accepted_at: '2026-01-02T00:00:00Z',
            idempotency_key: 'idem-0',
          });
          await tx.upsertHead({
            ledger_id: 'L2',
            artifact_id: 'A',
            version_id: 'V',
            event_id: 'e0',
            updated_at: '2026-01-02T00:00:00Z',
          });
        });
        expect((await adapter.getHead('L1', 'A'))?.version_id).toBe('V2');
        expect((await adapter.getHead('L2', 'A'))?.version_id).toBe('V');

        // Re-running is a no-op.
        await expect(runMigrations(adapter, migrations)).resolves.toBeUndefined();
      } finally {
        if (cleanup) await cleanup(adapter);
      }
    });
  });
}
