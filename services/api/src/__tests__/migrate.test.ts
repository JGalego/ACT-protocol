import { describe, expect, it } from 'vitest';
import { runMigration } from '../bin/migrate.js';

describe('runMigration', () => {
  it('applies migrations and returns a fresh ledger id', async () => {
    const ledgerId = await runMigration(':memory:');
    expect(ledgerId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
