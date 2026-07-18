import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { CheckResult } from './types.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Core profile: schema validation of every positive/negative fixture under
 * schemas/**\/fixtures/ (spec/conformance.md section 2). Reuses
 * scripts/validate-schemas.ts as-is (invoked as a subprocess) rather than
 * re-implementing schema validation here, so there is exactly one schema
 * checker, not two that could drift.
 */
export function run(): CheckResult[] {
  let stdout = '';
  let ok = true;
  try {
    stdout = execFileSync('npx', ['tsx', 'scripts/validate-schemas.ts'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
  } catch (err) {
    ok = false;
    stdout = (err as { stdout?: string }).stdout ?? String(err);
  }

  const match = stdout.match(/Checked (\d+) fixtures across (\d+) schemas, (\d+) failure\(s\)/);
  const fixtureCount = match ? Number(match[1]) : 0;
  const failureCount = match ? Number(match[3]) : ok ? 0 : 1;

  return [
    {
      id: 'schema-fixtures/all',
      category: 'schema-fixtures',
      profile: 'core',
      expected: '0 failures',
      actual: match ? `${failureCount} failure(s) across ${fixtureCount} fixtures` : stdout.trim(),
      pass: ok && failureCount === 0,
    },
  ];
}
