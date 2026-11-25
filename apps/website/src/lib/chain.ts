// Toy payloads for the landing-page tamper demo. Not the protocol's real event
// schema: just enough structure to show hash-linking and signing working.

export interface Seed {
  kind: string;
  who: string;
  /** Key owner: events by the same actor share a demo key. */
  by: 'human' | 'ai' | 'verifier';
  data: string;
}

export const SEEDS: Seed[] = [
  { kind: 'Intent', who: 'human', by: 'human', data: 'Triage support tickets' },
  { kind: 'Transformation', who: 'AI agent', by: 'ai', data: 'Draft requirements' },
  { kind: 'Approval', who: 'human', by: 'human', data: 'Approve scope' },
  { kind: 'Verification', who: 'verifier', by: 'verifier', data: 'Check lineage' },
];

export const TAMPERED_DATA = 'Delete support tickets';

/** Canonical string that gets hashed: fixed key order, so build and browser agree. */
export function payload(e: {
  kind: string;
  by: string;
  data: string;
  prev: string | null;
}): string {
  return JSON.stringify({ by: e.by, data: e.data, kind: e.kind, prev: e.prev });
}
