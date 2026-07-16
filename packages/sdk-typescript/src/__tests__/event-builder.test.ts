import { describe, expect, it } from 'vitest';
import { buildUnsignedEvent, newArtifactId } from '../event-builder.js';

describe('buildUnsignedEvent', () => {
  it('fills protocol defaults', () => {
    const event = buildUnsignedEvent({
      eventType: 'genesis',
      actor: { actorId: 'a1', keyId: 'ed25519:aaaa' },
      tenant: 'test',
      subject: { kind: 'artifact', artifact_id: 'art-1' },
      payload: { foo: 'bar' },
    });
    expect(event.protocol_version).toBe('act/1.0');
    expect(event.event_type).toBe('genesis');
    expect(event.causal_parents).toEqual([]);
    expect(event.content_descriptors).toEqual([]);
    expect(event.extensions).toEqual({});
    expect(event.policy_context).toEqual({ not_applicable: true, reason: 'no policy configured' });
    expect(typeof event.occurred_at).toBe('string');
  });

  it('honors explicit occurredAt, causalParents, and policyContext', () => {
    const event = buildUnsignedEvent({
      eventType: 'transformation_recorded',
      actor: { actorId: 'a1', keyId: 'ed25519:aaaa' },
      tenant: { not_applicable: true, reason: 'no tenant' },
      subject: { kind: 'transformation' },
      causalParents: [{ event_id: 'sha-256:' + '1'.repeat(64) }],
      policyContext: { policy_id: 'p1', policy_version: 'sha-256:' + '2'.repeat(64) },
      occurredAt: '2026-01-01T00:00:00Z',
      payload: {},
    });
    expect(event.occurred_at).toBe('2026-01-01T00:00:00Z');
    expect(event.causal_parents).toEqual([{ event_id: 'sha-256:' + '1'.repeat(64) }]);
    expect(event.policy_context).toEqual({
      policy_id: 'p1',
      policy_version: 'sha-256:' + '2'.repeat(64),
    });
  });
});

describe('newArtifactId', () => {
  it('generates distinct UUIDv7 ids', () => {
    const a = newArtifactId();
    const b = newArtifactId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });
});
