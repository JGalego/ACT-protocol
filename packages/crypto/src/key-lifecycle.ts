/**
 * Key lifecycle states, per ACT-1.0.md section 11.2 / spec/state-machines.md
 * section 5. This module is pure (no storage): the ledger persists Key
 * Status Change events; @act/verification combines this evaluation with
 * ledger-recorded history to decide whether a given signature was made
 * while its key was in good standing.
 */
export type KeyStatus = 'issued' | 'active' | 'rotated' | 'expired' | 'revoked' | 'compromised';

export interface KeyStatusEvent {
  status: KeyStatus;
  /** ISO 8601 timestamp at which this status took effect (ledger acceptance time, not actor-claimed time). */
  effectiveAt: string;
}

export interface KeyValidityResult {
  /** The key's status that was in effect at the queried time. */
  statusAtTime: KeyStatus;
  /** Whether a signature made at the queried time should be trusted, per section 11.2's rules. */
  validForSigning: boolean;
  reason: string;
}

const TRUSTED_SIGNING_STATUSES: ReadonlySet<KeyStatus> = new Set(['issued', 'active']);

/**
 * Evaluates a key's status as of a given time from its ordered history of
 * status-change events (oldest first), and whether a signature made at that
 * time should be trusted. `compromised` retroactively invalidates
 * signatures within `compromiseGracePeriodMs` before the compromise was
 * recorded, per the documented grace-period rule in
 * docs/security-and-privacy-guide.md; `expired`/`rotated`/`revoked` do not
 * retroactively invalidate signatures made while the key was still active.
 */
export function evaluateKeyValidityAt(
  history: KeyStatusEvent[],
  queryTimeIso: string,
  options: { compromiseGracePeriodMs?: number } = {},
): KeyValidityResult {
  if (history.length === 0) {
    return { statusAtTime: 'issued', validForSigning: false, reason: 'no key history recorded' };
  }
  const queryTime = Date.parse(queryTimeIso);
  const sorted = [...history].sort((a, b) => Date.parse(a.effectiveAt) - Date.parse(b.effectiveAt));

  const compromiseEvent = sorted.find((e) => e.status === 'compromised');
  if (compromiseEvent) {
    const graceMs = options.compromiseGracePeriodMs ?? 24 * 60 * 60 * 1000;
    const compromiseRecordedAt = Date.parse(compromiseEvent.effectiveAt);
    if (queryTime >= compromiseRecordedAt - graceMs) {
      return {
        statusAtTime: 'compromised',
        validForSigning: false,
        reason: `key flagged compromised at ${compromiseEvent.effectiveAt}; signature falls within the ${graceMs}ms retroactive grace window`,
      };
    }
  }

  let current: KeyStatusEvent = sorted[0]!;
  for (const event of sorted) {
    if (Date.parse(event.effectiveAt) > queryTime) break;
    current = event;
  }

  const validForSigning = TRUSTED_SIGNING_STATUSES.has(current.status);
  return {
    statusAtTime: current.status,
    validForSigning,
    reason: validForSigning
      ? `key was '${current.status}' at ${queryTimeIso}`
      : `key was '${current.status}' (not issued/active) at ${queryTimeIso}`,
  };
}
