#!/usr/bin/env -S node --import tsx
/**
 * Profile-aware conformance report generator (spec/conformance.md). Runs
 * every check category, aggregates results per profile (profiles are
 * cumulative: "Core, plus: ..."), and writes both a machine-readable
 * CONFORMANCE_REPORT.json and a generated CONFORMANCE_REPORT.md from the
 * SAME in-memory result object, so the two can never disagree.
 *
 * A profile is reported as claimed (`pass: true`) only if every check in
 * that profile AND every profile it builds on passes -- never asserted
 * from prose. Profiles with no checks implemented yet are reported
 * explicitly as not claimed, with a reason, rather than silently omitted.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as canonicalizationCheck from './checks/canonicalization.js';
import * as signaturesCheck from './checks/signatures.js';
import * as schemaFixturesCheck from './checks/schema-fixtures.js';
import * as graphCheck from './checks/graph.js';
import * as federationCheck from './checks/federation.js';
import * as sdkInteropCheck from './checks/sdk-interop.js';
import type { CheckResult, Profile } from './checks/types.js';

const CONFORMANCE_DIR = join(dirname(fileURLToPath(import.meta.url)));

// Cumulative per spec/conformance.md section 1's "Core, plus: ..." table.
const PROFILE_PREREQUISITES: Record<Profile, Profile[]> = {
  core: [],
  'cryptographic-integrity': ['core'],
  'secure-service': ['core', 'cryptographic-integrity'],
  federation: ['core', 'cryptographic-integrity'],
  sdk: ['core', 'cryptographic-integrity'],
  explorer: ['core', 'cryptographic-integrity', 'secure-service'],
};

// Profiles with zero checks below are reported as not-yet-claimable, with
// the reason recorded -- see docs/roadmap.md for what's tracked there.
const NOT_YET_COVERED: Partial<Record<Profile, string>> = {
  'secure-service':
    'Tenant isolation and policy-based authorization tests are not yet part of this runner (OIDC auth exists in services/api, but no dedicated conformance fixtures reference it yet).',
  explorer:
    'Requires the secure-service profile plus every ACT Explorer workflow from PROMPT.md; apps/explorer implements an animated demonstration, not yet the full operational profile (docs/roadmap.md).',
};

function main(): void {
  const results: CheckResult[] = [
    ...canonicalizationCheck.run(),
    ...signaturesCheck.run(),
    ...schemaFixturesCheck.run(),
    ...graphCheck.run(),
    ...federationCheck.run(),
    ...sdkInteropCheck.run(),
  ];

  const allProfiles = Object.keys(PROFILE_PREREQUISITES) as Profile[];
  const profiles: Record<
    string,
    { claimed: boolean; pass: boolean; fixtureCount: number; reason?: string }
  > = {};

  for (const profile of allProfiles) {
    const relevantProfiles = [...PROFILE_PREREQUISITES[profile], profile];
    const relevantResults = results.filter((r) => relevantProfiles.includes(r.profile));
    const hasOwnChecks = results.some((r) => r.profile === profile);
    const notCovered = NOT_YET_COVERED[profile];

    if (!hasOwnChecks || notCovered) {
      profiles[profile] = {
        claimed: false,
        pass: false,
        fixtureCount: relevantResults.length,
        reason: notCovered ?? `No checks implemented yet for the ${profile} profile.`,
      };
      continue;
    }

    const allPass = relevantResults.length > 0 && relevantResults.every((r) => r.pass);
    profiles[profile] = {
      claimed: allPass,
      pass: allPass,
      fixtureCount: relevantResults.length,
    };
  }

  const totals = {
    checked: results.length,
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
  };

  const report = {
    generatedAt: process.env.ACT_CONFORMANCE_TIMESTAMP ?? new Date().toISOString(),
    specVersion: 'act/1.0',
    totals,
    profiles,
    results,
  };

  writeFileSync(
    join(CONFORMANCE_DIR, 'CONFORMANCE_REPORT.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  writeFileSync(join(CONFORMANCE_DIR, 'CONFORMANCE_REPORT.md'), renderMarkdown(report));

  console.log(
    `Checked ${totals.checked} conformance fixtures: ${totals.passed} passed, ${totals.failed} failed.`,
  );
  for (const [profile, info] of Object.entries(profiles)) {
    console.log(
      `  ${profile}: ${info.claimed ? 'CLAIMED' : 'not claimed'}${info.reason ? ` (${info.reason})` : ''}`,
    );
  }

  // Fails the build only if a CLAIMED profile's checks don't all pass, or
  // if any implemented check unexpectedly failed. A profile that's
  // honestly not-yet-covered does not fail the build -- see
  // spec/conformance.md section 3.
  const anyImplementedFailure = results.some((r) => !r.pass);
  if (anyImplementedFailure) {
    console.error('\nOne or more implemented conformance checks failed.');
    process.exit(1);
  }
}

function renderMarkdown(report: {
  generatedAt: string;
  specVersion: string;
  totals: { checked: number; passed: number; failed: number };
  profiles: Record<
    string,
    { claimed: boolean; pass: boolean; fixtureCount: number; reason?: string }
  >;
  results: CheckResult[];
}): string {
  const lines: string[] = [];
  lines.push('# ACT Conformance Report');
  lines.push('');
  lines.push(
    `Generated by \`conformance/run-conformance.ts\`. Spec version: \`${report.specVersion}\`.`,
  );
  lines.push('');
  lines.push(
    `**Totals:** ${report.totals.checked} checked, ${report.totals.passed} passed, ${report.totals.failed} failed.`,
  );
  lines.push('');
  lines.push('## Profiles');
  lines.push('');
  lines.push('| Profile | Claimed | Fixtures Checked | Notes |');
  lines.push('| --- | --- | --- | --- |');
  for (const [profile, info] of Object.entries(report.profiles)) {
    lines.push(
      `| ${profile} | ${info.claimed ? '✅ yes' : '❌ not claimed'} | ${info.fixtureCount} | ${info.reason ?? '—'} |`,
    );
  }
  lines.push('');

  const failures = report.results.filter((r) => !r.pass);
  if (failures.length > 0) {
    lines.push('## Failures');
    lines.push('');
    for (const f of failures) {
      lines.push(
        `- **${f.id}** (${f.category}, ${f.profile}): expected \`${f.expected}\`, got \`${f.actual}\``,
      );
    }
    lines.push('');
  }

  lines.push('## All Results');
  lines.push('');
  lines.push('| ID | Category | Profile | Pass |');
  lines.push('| --- | --- | --- | --- |');
  for (const r of report.results) {
    lines.push(`| ${r.id} | ${r.category} | ${r.profile} | ${r.pass ? '✅' : '❌'} |`);
  }
  lines.push('');

  return lines.join('\n');
}

main();
