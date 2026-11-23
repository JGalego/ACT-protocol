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
  // Fail closed on anything unparseable: a query time or history timestamp
  // that is not a real instant must never make a signature look valid.
  const queryTime = Date.parse(queryTimeIso);
  if (Number.isNaN(queryTime)) {
    return {
      statusAtTime: 'issued',
      validForSigning: false,
      reason: `query time ${JSON.stringify(queryTimeIso)} is not a parseable timestamp`,
    };
  }
  const timed = history.map((event) => ({ event, at: Date.parse(event.effectiveAt) }));
  const badEntry = timed.find((entry) => Number.isNaN(entry.at));
  if (badEntry) {
    return {
      statusAtTime: 'issued',
      validForSigning: false,
      reason: `key history contains an unparseable effectiveAt ${JSON.stringify(badEntry.event.effectiveAt)}`,
    };
  }
  const sorted = [...timed].sort((a, b) => a.at - b.at);

  const compromise = sorted.find((entry) => entry.event.status === 'compromised');
  if (compromise) {
    const graceMs = options.compromiseGracePeriodMs ?? 24 * 60 * 60 * 1000;
    if (queryTime >= compromise.at - graceMs) {
      return {
        statusAtTime: 'compromised',
        validForSigning: false,
        reason: `key flagged compromised at ${compromise.event.effectiveAt}; signature falls within the ${graceMs}ms retroactive grace window`,
      };
    }
  }

  // A signature dated before the key's first recorded status cannot have been
  // made by a key that did not exist yet.
  if (queryTime < sorted[0]!.at) {
    return {
      statusAtTime: 'issued',
      validForSigning: false,
      reason: `key did not exist at ${queryTimeIso} (first recorded status at ${sorted[0]!.event.effectiveAt})`,
    };
  }

  let current = sorted[0]!.event;
  for (const entry of sorted) {
    if (entry.at > queryTime) break;
    current = entry.event;
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
