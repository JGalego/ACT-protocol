import type {
  ActorSummary,
  EventKind,
  EventStatus,
  ExplorerEvent,
  ExplorerScenario,
} from '../types';

interface StoredEventWire {
  eventId: string;
  sequence: number;
  eventType: string;
  acceptedAt: string;
  envelope: unknown;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function eventKind(eventType: string, artifactType: string): EventKind {
  if (eventType.includes('approval')) return 'approval';
  if (eventType.includes('challenge')) return 'challenge';
  if (eventType.includes('verification')) return 'verification';
  if (eventType.includes('transformation')) return 'transformation';
  if (eventType.includes('observation')) return 'observation';
  if (eventType.includes('revised') || artifactType === 'revision') return 'revision';
  if (artifactType === 'intent') return 'intent';
  if (artifactType.includes('proposal')) return 'proposal';
  if (artifactType === 'source-code' || artifactType === 'architecture') return 'implementation';
  if (artifactType === 'test') return 'test';
  return 'event';
}

function eventStatus(kind: EventKind, eventType: string): EventStatus {
  if (eventType.includes('revoked') || eventType.includes('challenge')) return 'challenged';
  if (eventType.includes('approved') || eventType === 'approval_decided') return 'approved';
  if (kind === 'verification' || kind === 'test') return 'passed';
  if (kind === 'observation') return 'observed';
  if (kind === 'proposal') return 'proposed';
  return 'recorded';
}

function titleFor(eventType: string, data: Record<string, unknown>, artifactType: string): string {
  return text(
    data.title ?? data.name ?? data.statement ?? data.objective ?? data.comment,
    artifactType ? artifactType.replaceAll('-', ' ') : eventType.replaceAll('_', ' '),
  );
}

function positionFor(index: number): { x: number; y: number } {
  const column = index % 6;
  const row = Math.floor(index / 6);
  return {
    x: row % 2 === 0 ? 100 + column * 205 : 1125 - column * 205,
    y: 120 + row * 210,
  };
}

function toExplorerEvent(stored: StoredEventWire, index: number): ExplorerEvent {
  const envelope = record(stored.envelope);
  const unsigned = record(envelope.payload);
  const subject = record(unsigned.subject);
  const payload = record(unsigned.payload);
  const data = record(payload.data);
  const actorRef = record(unsigned.actor);
  const artifactType = text(subject.artifact_type ?? data.artifact_type, '');
  const parentItems = Array.isArray(unsigned.causal_parents) ? unsigned.causal_parents : [];
  const signatureItems = Array.isArray(envelope.signatures) ? envelope.signatures : [];
  const actorId = text(actorRef.actor_id, 'unknown actor');
  const kind = eventKind(stored.eventType, artifactType);
  const actor: ActorSummary = {
    id: actorId,
    name: actorId.length > 24 ? `${actorId.slice(0, 12)}...${actorId.slice(-6)}` : actorId,
    role: 'Ledger actor',
    type: 'service',
  };

  return {
    id: stored.eventId,
    sequence: stored.sequence,
    eventType: stored.eventType,
    kind,
    status: eventStatus(kind, stored.eventType),
    title: titleFor(stored.eventType, data, artifactType),
    summary: text(data.description ?? data.rationale ?? data.scope, 'Recorded ACT ledger event.'),
    timestamp: new Date(stored.acceptedAt).toLocaleTimeString([], { hour12: false }),
    actor,
    parents: parentItems.map((item) => {
      const parent = record(item);
      return {
        id: text(parent.event_id, 'missing-parent'),
        relation: text(parent.relation, 'causal-parent'),
      };
    }),
    position: positionFor(index),
    digest: stored.eventId,
    signatureStatus: signatureItems.length > 0 ? 'attached' : 'missing',
    semanticChange: text(
      record(payload.semantic_change_claim).classification,
      'Not classified in this event',
    ),
    rationale: text(payload.rationale ?? data.rationale, 'No rationale recorded in this payload.'),
    assumptions: Array.isArray(payload.assumptions)
      ? payload.assumptions.map((item) =>
          text(record(item).statement ?? item, 'Recorded assumption'),
        )
      : [],
    uncertainties: Array.isArray(payload.uncertainties)
      ? payload.uncertainties.map((item) =>
          text(record(item).description ?? item, 'Recorded uncertainty'),
        )
      : [],
    evidence: [],
    confidence: { semantic: 0, implementation: 0, verification: 0 },
    payload: unsigned,
  };
}

export async function loadLiveScenario(
  baseUrl: string,
  bearerToken: string,
): Promise<ExplorerScenario> {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  const events: StoredEventWire[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ limit: '500' });
    if (cursor) query.set('cursor', cursor);
    const response = await fetch(`${normalizedBaseUrl}/v1/events?${query.toString()}`, {
      headers: bearerToken ? { authorization: `Bearer ${bearerToken}` } : {},
    });
    if (!response.ok) {
      throw new Error(
        `Ledger returned HTTP ${response.status}. Check the URL and bearer actor id.`,
      );
    }
    const body = record(await response.json());
    const items = Array.isArray(body.items) ? (body.items as StoredEventWire[]) : [];
    events.push(...items);
    cursor = typeof body.nextCursor === 'string' ? body.nextCursor : null;
    if (!cursor) break;
  }

  if (events.length === 0) {
    throw new Error('The ledger is reachable but contains no events to explore.');
  }

  const explorerEvents = events.map(toExplorerEvent);
  return {
    id: 'live-ledger',
    name: 'Connected ACT ledger',
    description: `${explorerEvents.length} events loaded from ${normalizedBaseUrl}.`,
    source: 'live',
    sourceDetail: normalizedBaseUrl,
    events: explorerEvents,
    stages: explorerEvents.map((item, index) => ({
      id: `live-${item.sequence}`,
      label: String(item.sequence),
      eyebrow: item.eventType.replaceAll('_', ' '),
      title: item.title,
      description: item.summary,
      focusEventId: item.id,
      visibleThrough: index + 1,
      callout: {
        tone: item.signatureStatus === 'attached' ? 'positive' : 'warning',
        label: item.signatureStatus === 'attached' ? 'Signed envelope' : 'Unsigned view',
        text: `${item.actor.name} recorded this event at ${item.timestamp}.`,
      },
      metrics: {
        records: index + 1,
        signatures: explorerEvents
          .slice(0, index + 1)
          .filter((event) => event.signatureStatus === 'attached').length,
        approvals: explorerEvents.slice(0, index + 1).filter((event) => event.kind === 'approval')
          .length,
        semanticConfidence: item.confidence.semantic,
        drift: 0,
      },
    })),
  };
}
