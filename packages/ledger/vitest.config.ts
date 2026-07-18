import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**'],
    // ledger.postgres.test.ts starts a real embedded PostgreSQL server (no
    // Docker needed, see __tests__/adapters/postgres-test-helper.ts) --
    // ~9s including server start/stop, cheap enough to run by default so
    // SQLite/PostgreSQL equivalence and postgres-adapter.ts's coverage are
    // both proven on every `pnpm test`, not gated behind an opt-in script.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: {
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
  },
});
