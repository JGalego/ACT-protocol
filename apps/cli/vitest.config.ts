import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
      // src/bin is thin Commander wiring around actions.ts (which holds all
      // real logic and is fully covered); it is exercised end-to-end by the
      // subprocess smoke test in cli-smoke.test.ts, which the v8 coverage
      // provider cannot attribute to this process.
      exclude: [...configDefaults.coverage.exclude!, 'src/bin/**'],
    },
  },
});
