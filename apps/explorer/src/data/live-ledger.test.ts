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

  it('explains an empty ledger instead of rendering a blank graph', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }),
    );

    await expect(loadLiveScenario('http://localhost:4000', '')).rejects.toThrow(
      'contains no events',
    );
  });
});
