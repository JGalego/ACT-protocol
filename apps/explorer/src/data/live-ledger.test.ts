import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadLiveScenario } from './live-ledger';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('live ledger adapter', () => {
  it('maps ordered stored events into an explorable timeline', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              eventId: `sha-256:${'a'.repeat(64)}`,
              sequence: 4,
              eventType: 'artifact_created',
              acceptedAt: '2026-07-17T09:00:00.000Z',
              envelope: {
                payload: {
                  actor: { actor_id: 'actor:live-user', key_id: 'ed25519:demo' },
                  subject: { kind: 'artifact', artifact_type: 'intent' },
                  causal_parents: [],
                  payload: {
                    data: {
                      artifact_type: 'intent',
                      statement: 'Ship a traceable release.',
                      scope: 'Live ledger fixture',
                    },
                  },
                },
                signatures: [{ keyid: 'ed25519:demo', sig: 'fixture' }],
              },
            },
          ],
          nextCursor: null,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const scenario = await loadLiveScenario('http://localhost:4000/', 'actor:live-user');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/v1/events?limit=500',
      expect.objectContaining({ headers: { authorization: 'Bearer actor:live-user' } }),
    );
    expect(scenario.source).toBe('live');
    expect(scenario.events).toHaveLength(1);
    expect(scenario.events[0]).toMatchObject({
      title: 'Ship a traceable release.',
      kind: 'intent',
      signatureStatus: 'attached',
    });
    expect(scenario.stages[0]?.focusEventId).toBe(scenario.events[0]?.id);
  });

  it('maps API-style PascalCase artifact types and does not show a rejection as approved', async () => {
    const stored = (n: number, eventType: string, artifactType: string, data: object) => ({
      eventId: `sha-256:${String(n).repeat(64)}`,
      sequence: n,
      eventType,
      acceptedAt: '2026-07-17T09:00:00.000Z',
      envelope: {
        payload: {
          actor: { actor_id: 'actor:a', key_id: 'ed25519:k' },
          subject: { kind: 'artifact', artifact_type: artifactType },
          causal_parents: [],
          payload: { data },
        },
        signatures: [{ key_id: 'ed25519:k', algorithm: 'ed25519', signature: 'x' }],
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            stored(1, 'genesis', 'Intent', { statement: 'An intent' }),
            stored(2, 'genesis', 'SourceCode', { language: 'ts' }),
            stored(3, 'approval_decided', 'ApprovalDecision', {
              decision: { decision: 'approved' },
            }),
            stored(4, 'approval_decided', 'ApprovalDecision', {
              decision: { decision: 'rejected' },
            }),
            stored(5, 'approval_decided', 'ApprovalDecision', {
              decision: { decision: 'changes_requested' },
            }),
          ],
          nextCursor: null,
        }),
        { status: 200 },
      ),
    );

    const { events } = await loadLiveScenario('http://localhost:4000', 'x');
    expect(events[0]).toMatchObject({ kind: 'intent' });
    expect(events[1]).toMatchObject({ kind: 'implementation' });
    expect(events[2]).toMatchObject({ kind: 'approval', status: 'approved' });
    expect(events[3]).toMatchObject({ kind: 'approval', status: 'challenged' });
    expect(events[4]).toMatchObject({ kind: 'approval', status: 'challenged' });
  });

  it('explains an empty ledger instead of rendering a blank graph', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }),
    );

    await expect(loadLiveScenario('http://localhost:4000', '')).rejects.toThrow(
      'contains no events',
    );
  });
});
