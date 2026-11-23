import { SqliteAdapter } from '../sqlite-adapter.js';
import { registerLedgerSuite } from './shared/ledger-suite.js';
import { registerTenantSuite } from './shared/tenant-suite.js';
import { registerAppendModelSuite } from './shared/append-model-suite.js';

registerLedgerSuite('sqlite', async () => {
  const adapter = SqliteAdapter.open(':memory:');
  await adapter.migrate();
  return adapter;
});

registerTenantSuite('sqlite', async () => {
  const adapter = SqliteAdapter.open(':memory:');
  await adapter.migrate();
  return adapter;
});

registerAppendModelSuite('sqlite', async () => {
  const adapter = SqliteAdapter.open(':memory:');
  await adapter.migrate();
  return adapter;
});
