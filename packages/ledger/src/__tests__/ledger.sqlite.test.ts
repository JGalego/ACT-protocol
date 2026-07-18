import { SqliteAdapter } from '../sqlite-adapter.js';
import { registerLedgerSuite } from './shared/ledger-suite.js';

registerLedgerSuite('sqlite', async () => {
  const adapter = SqliteAdapter.open(':memory:');
  await adapter.migrate();
  return adapter;
});
