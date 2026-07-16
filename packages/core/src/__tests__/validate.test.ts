import { describe, expect, it } from 'vitest';
import { artifactTypeSchemaId, getAjv, SCHEMA_IDS, validateAgainst } from '../validate.js';

describe('getAjv', () => {
  it('registers every schema under schemas/ by $id', () => {
    const ajv = getAjv();
    expect(ajv.getSchema(SCHEMA_IDS.unsignedEvent)).toBeDefined();
    expect(ajv.getSchema(SCHEMA_IDS.ledgerReceipt)).toBeDefined();
    expect(ajv.getSchema(SCHEMA_IDS.signedEnvelope)).toBeDefined();
    expect(ajv.getSchema(artifactTypeSchemaId('intent'))).toBeDefined();
  });
});

describe('validateAgainst', () => {
  it('validates a well-formed genesis event', () => {
    const event = {
      protocol_version: 'act/1.0',
      event_type: 'genesis',
      occurred_at: '2026-07-16T00:00:00Z',
      actor: {
        actor_id: '018f5b1a-0000-7000-8000-000000000010',
        key_id: 'ed25519:aaaaaaaaaaaaaaaa',
      },
      tenant: 'act-protocol',
      subject: { kind: 'artifact', artifact_id: '018f5b1a-0000-7000-8000-000000000011' },
      causal_parents: [],
      content_descriptors: [],
      policy_context: { not_applicable: true, reason: 'genesis' },
      payload: {},
      extensions: {},
    };
    const result = validateAgainst(SCHEMA_IDS.unsignedEvent, event);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects a genesis event with non-empty causal_parents', () => {
    const event = {
      protocol_version: 'act/1.0',
      event_type: 'genesis',
      occurred_at: '2026-07-16T00:00:00Z',
      actor: {
        actor_id: '018f5b1a-0000-7000-8000-000000000010',
        key_id: 'ed25519:aaaaaaaaaaaaaaaa',
      },
      tenant: 'act-protocol',
      subject: { kind: 'artifact', artifact_id: '018f5b1a-0000-7000-8000-000000000011' },
      causal_parents: [{ event_id: `sha-256:${'1'.repeat(64)}` }],
      content_descriptors: [],
      policy_context: { not_applicable: true, reason: 'genesis' },
      payload: {},
      extensions: {},
    };
    const result = validateAgainst(SCHEMA_IDS.unsignedEvent, event);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects an unrecognized additional property (strict schema, closed world)', () => {
    const result = validateAgainst(SCHEMA_IDS.ledgerReceipt, {
      ledger_id: '018f5b1a-0000-7000-8000-000000000020',
      sequence: 0,
      event_id: `sha-256:${'1'.repeat(64)}`,
      accepted_at: '2026-07-16T00:00:01Z',
      previous_receipt_digest: `sha-256:${'0'.repeat(64)}`,
      receipt_digest: `sha-256:${'3'.repeat(64)}`,
      signature: {
        key_id: 'ed25519:cccccccccccccccc',
        algorithm: 'ed25519',
        signature: 'ZmFrZQ==',
      },
      unknown_field: 'should not be allowed',
    });
    expect(result.valid).toBe(false);
  });

  it('throws for an unregistered schema id', () => {
    expect(() =>
      validateAgainst('https://schemas.act-protocol.org/1.0/does/not-exist.schema.json', {}),
    ).toThrow();
  });
});
