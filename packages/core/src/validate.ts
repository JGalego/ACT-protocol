import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';

// RFC 3339 date-time, the only Ajv "format" this protocol's schemas use
// (occurred_at, accepted_at, issued_at, expires_at, etc.). Implemented
// directly rather than pulling in ajv-formats for one keyword.
const RFC3339_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Ships alongside src/dist, populated by scripts/sync-schemas.mjs.
const SCHEMAS_ROOT = path.resolve(__dirname, '../schemas');

function walkSchemaFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkSchemaFiles(full, out);
    } else if (entry.endsWith('.schema.json')) {
      out.push(full);
    }
  }
  return out;
}

let ajvSingleton: Ajv2020 | undefined;

function buildAjv(): Ajv2020 {
  const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
  ajv.addFormat('date-time', {
    type: 'string',
    validate: (value: string) => RFC3339_DATE_TIME.test(value) && !Number.isNaN(Date.parse(value)),
  });
  for (const file of walkSchemaFiles(SCHEMAS_ROOT)) {
    const schema = JSON.parse(readFileSync(file, 'utf8'));
    if (schema.$id && !ajv.getSchema(schema.$id)) {
      ajv.addSchema(schema);
    }
  }
  return ajv;
}

/** Lazily builds (once) and returns the shared Ajv instance with every ACT schema registered by $id. */
export function getAjv(): Ajv2020 {
  if (!ajvSingleton) ajvSingleton = buildAjv();
  return ajvSingleton;
}

export interface ValidationResult {
  valid: boolean;
  errors: ErrorObject[];
}

/** Validates a value against a schema identified by its canonical $id. Throws if the $id is unregistered. */
export function validateAgainst(schemaId: string, value: unknown): ValidationResult {
  const ajv = getAjv();
  const validateFn: ValidateFunction | undefined = ajv.getSchema(schemaId);
  if (!validateFn) {
    throw new Error(`No schema registered for $id: ${schemaId}`);
  }
  const valid = validateFn(value) as boolean;
  return { valid, errors: valid ? [] : (validateFn.errors ?? []) };
}

export const SCHEMA_IDS = {
  unsignedEvent: 'https://schemas.act-protocol.org/1.0/event/unsigned-event.schema.json',
  signedEnvelope: 'https://schemas.act-protocol.org/1.0/envelope/signed-envelope.schema.json',
  ledgerReceipt: 'https://schemas.act-protocol.org/1.0/event/ledger-receipt.schema.json',
  artifactEnvelope: 'https://schemas.act-protocol.org/1.0/artifact/artifact-envelope.schema.json',
  transformation: 'https://schemas.act-protocol.org/1.0/artifact/transformation.schema.json',
  policy: 'https://schemas.act-protocol.org/1.0/policy/policy.schema.json',
  authorityPolicy: 'https://schemas.act-protocol.org/1.0/policy/authority-policy.schema.json',
  approvalRequest: 'https://schemas.act-protocol.org/1.0/approval/approval-request.schema.json',
  approvalDecision: 'https://schemas.act-protocol.org/1.0/approval/approval-decision.schema.json',
  challenge: 'https://schemas.act-protocol.org/1.0/challenge/challenge.schema.json',
  bundle: 'https://schemas.act-protocol.org/1.0/federation/bundle.schema.json',
} as const;

/** Builds the $id for a generated artifact-type schema, e.g. artifactTypeSchemaId('Intent'). */
export function artifactTypeSchemaId(slug: string): string {
  return `https://schemas.act-protocol.org/1.0/artifact/types/${slug}.schema.json`;
}
