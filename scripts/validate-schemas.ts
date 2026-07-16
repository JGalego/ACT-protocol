#!/usr/bin/env -S node --import tsx
// Validates every fixture under schemas/**/fixtures/{positive,negative}
// against its corresponding schema. Positive fixtures MUST validate;
// negative fixtures MUST be rejected. Run via `pnpm run schemas:validate`
// (part of `make verify`). Exits non-zero on any unexpected result.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCHEMAS_DIR = path.join(ROOT, 'schemas');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (entry.endsWith('.schema.json')) {
      out.push(full);
    }
  }
  return out;
}

// RFC 3339 date-time -- see packages/core/src/validate.ts for why this is
// hand-rolled instead of depending on ajv-formats for one keyword.
const RFC3339_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i;

const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
ajv.addFormat('date-time', {
  type: 'string',
  validate: (value: string) => RFC3339_DATE_TIME.test(value) && !Number.isNaN(Date.parse(value)),
});

const schemaFiles = walk(SCHEMAS_DIR);
for (const file of schemaFiles) {
  const schema = JSON.parse(readFileSync(file, 'utf8'));
  if (schema.$id && !ajv.getSchema(schema.$id)) ajv.addSchema(schema);
}

let failures = 0;
let checked = 0;

function envelopeWrap(dataFixture: Record<string, unknown>, artifactType: string): unknown {
  return {
    artifact_id: '018f5b1a-0000-7000-8000-0000000000ff',
    version_id: `sha-256:${'0'.repeat(64)}`,
    artifact_type: artifactType,
    schema_version: '1.0',
    protocol_version: 'act/1.0',
    authoring_actor: {
      actor_id: '018f5b1a-0000-7000-8000-0000000000fe',
      key_id: `ed25519:${'f'.repeat(16)}`,
    },
    created_at_claim: '2026-07-16T00:00:00Z',
    content: {
      media_type: 'application/json',
      byte_length: 0,
      digest: `sha-256:${'0'.repeat(64)}`,
      storage: { kind: 'inline', inline_value: '' },
      sensitivity: 'internal',
      availability_state: 'available',
    },
    lineage: [],
    applicable_policy: { not_applicable: true, reason: 'fixture' },
    confidence_assessments: [],
    uncertainties: [],
    evidence_refs: [],
    signatures: [
      { key_id: `ed25519:${'f'.repeat(16)}`, algorithm: 'ed25519', signature: 'ZmFrZQ==' },
    ],
    sensitivity: 'internal',
    retention_policy_id: null,
    data: dataFixture,
  };
}

function checkFixtureDir(schemaId: string, dir: string, expectValid: boolean, wrap?: string) {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  const validate = ajv.getSchema(schemaId);
  if (!validate) {
    console.error(`No schema registered for ${schemaId} (needed by fixtures in ${dir})`);
    failures++;
    return;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const fixture = JSON.parse(readFileSync(path.join(dir, entry), 'utf8'));
    const instance = wrap ? envelopeWrap(fixture, wrap) : fixture;
    const valid = validate(instance) as boolean;
    checked++;
    if (valid !== expectValid) {
      failures++;
      console.error(
        `FAIL ${path.relative(ROOT, path.join(dir, entry))}: expected ${expectValid ? 'valid' : 'invalid'}, got ${valid ? 'valid' : 'invalid'}`,
      );
      if (expectValid && validate.errors) {
        console.error(JSON.stringify(validate.errors, null, 2));
      }
    }
  }
}

// Artifact-type fixtures: data.json fixtures wrapped in a minimal envelope.
// Each type's own positive fixture is named <slug>.data.json and MUST be
// checked only against that type's own schema (not the whole directory).
const typesDir = path.join(SCHEMAS_DIR, 'artifact/types');
const indexPath = path.join(typesDir, 'index.json');
const index = JSON.parse(readFileSync(indexPath, 'utf8')) as {
  types: { name: string; id: string; file: string }[];
};
for (const t of index.types) {
  const slug = t.file.replace('.schema.json', '');
  const posFile = path.join(typesDir, 'fixtures/positive', `${slug}.data.json`);
  const validate = ajv.getSchema(t.id);
  if (!validate) {
    console.error(`No schema registered for ${t.id}`);
    failures++;
    continue;
  }
  let fixture: unknown;
  try {
    fixture = JSON.parse(readFileSync(posFile, 'utf8'));
  } catch {
    continue; // wrapper types (ApprovalRequest, ApprovalDecision, Challenge, Policy) have no standalone example
  }
  const instance = envelopeWrap(fixture as Record<string, unknown>, t.name);
  checked++;
  const valid = validate(instance) as boolean;
  if (!valid) {
    failures++;
    console.error(`FAIL ${path.relative(ROOT, posFile)}: expected valid, got invalid`);
    console.error(JSON.stringify(validate.errors, null, 2));
  }
}
// Negative fixtures are named <slug>.data.missing-<field>.json; each belongs to exactly one type.
for (const t of index.types) {
  const slug = path.basename(t.id).replace('.schema.json', '');
  const negDir = path.join(typesDir, 'fixtures/negative');
  let entries: string[] = [];
  try {
    entries = readdirSync(negDir).filter((e) => e.startsWith(`${slug}.data.missing-`));
  } catch {
    entries = [];
  }
  const validate = ajv.getSchema(t.id)!;
  for (const entry of entries) {
    const fixture = JSON.parse(readFileSync(path.join(negDir, entry), 'utf8'));
    const instance = envelopeWrap(fixture, t.name);
    checked++;
    const valid = validate(instance) as boolean;
    if (valid !== false) {
      failures++;
      console.error(
        `FAIL ${path.relative(ROOT, path.join(negDir, entry))}: expected invalid, got valid`,
      );
    }
  }
}

// Protocol-level (unwrapped) fixtures: each schema's own fixtures/positive
// and fixtures/negative directories, validated directly with no envelope.
function SCHEMA(relIdPath: string): string {
  return `https://schemas.act-protocol.org/1.0/${relIdPath}.schema.json`;
}

// [schemaId, areaDir, fixtureSubdir] -- fixtureSubdir disambiguates when an
// area directory hosts fixtures for more than one schema (e.g. schemas/event
// has both unsigned-event and ledger-receipt fixtures).
const PROTOCOL_SCHEMAS: [string, string, string][] = [
  [SCHEMA('event/unsigned-event'), 'event', 'unsigned-event'],
  [SCHEMA('event/ledger-receipt'), 'event', 'ledger-receipt'],
  [SCHEMA('envelope/signed-envelope'), 'envelope', '.'],
  [SCHEMA('artifact/transformation'), 'artifact', '.'],
  [SCHEMA('policy/policy'), 'policy', '.'],
  [SCHEMA('approval/approval-request'), 'approval', 'approval-request'],
  [SCHEMA('approval/approval-decision'), 'approval', 'approval-decision'],
  [SCHEMA('challenge/challenge'), 'challenge', '.'],
  [SCHEMA('federation/bundle'), 'federation', '.'],
];

for (const [schemaId, area, sub] of PROTOCOL_SCHEMAS) {
  checkFixtureDir(schemaId, path.join(SCHEMAS_DIR, area, 'fixtures/positive', sub), true);
  checkFixtureDir(schemaId, path.join(SCHEMAS_DIR, area, 'fixtures/negative', sub), false);
}

console.log(
  `Checked ${checked} fixtures across ${schemaFiles.length} schemas, ${failures} failure(s).`,
);
if (failures > 0) process.exit(1);
