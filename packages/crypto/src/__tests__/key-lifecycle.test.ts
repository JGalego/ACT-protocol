import { describe, expect, it } from 'vitest';
import { evaluateKeyValidityAt, type KeyStatusEvent } from '../key-lifecycle.js';

describe('evaluateKeyValidityAt', () => {
  it('reports no history as invalid for signing', () => {
    const result = evaluateKeyValidityAt([], '2026-01-01T00:00:00Z');
    expect(result.validForSigning).toBe(false);
  });

  it('treats a key as valid for signing while active', () => {
    const history: KeyStatusEvent[] = [{ status: 'issued', effectiveAt: '2026-01-01T00:00:00Z' }];
    const result = evaluateKeyValidityAt(history, '2026-01-15T00:00:00Z');
    expect(result.statusAtTime).toBe('issued');
    expect(result.validForSigning).toBe(true);
  });

  it('does not retroactively invalidate signatures made before expiry', () => {
    const history: KeyStatusEvent[] = [
      { status: 'active', effectiveAt: '2026-01-01T00:00:00Z' },
      { status: 'expired', effectiveAt: '2026-06-01T00:00:00Z' },
    ];
    const beforeExpiry = evaluateKeyValidityAt(history, '2026-03-01T00:00:00Z');
    expect(beforeExpiry.validForSigning).toBe(true);
    const afterExpiry = evaluateKeyValidityAt(history, '2026-07-01T00:00:00Z');
    expect(afterExpiry.validForSigning).toBe(false);
    expect(afterExpiry.statusAtTime).toBe('expired');
  });

  it('does not retroactively invalidate signatures made before revocation', () => {
    const history: KeyStatusEvent[] = [
      { status: 'active', effectiveAt: '2026-01-01T00:00:00Z' },
      { status: 'revoked', effectiveAt: '2026-06-01T00:00:00Z' },
    ];
    expect(evaluateKeyValidityAt(history, '2026-03-01T00:00:00Z').validForSigning).toBe(true);
    expect(evaluateKeyValidityAt(history, '2026-07-01T00:00:00Z').validForSigning).toBe(false);
  });

  it('retroactively invalidates signatures within the compromise grace period', () => {
    const history: KeyStatusEvent[] = [
      { status: 'active', effectiveAt: '2026-01-01T00:00:00Z' },
      { status: 'compromised', effectiveAt: '2026-06-10T00:00:00Z' },
    ];
    // 12 hours before the compromise was recorded, within the default 24h grace window.
    const result = evaluateKeyValidityAt(history, '2026-06-09T12:00:00Z', {
      compromiseGracePeriodMs: 24 * 60 * 60 * 1000,
    });
    expect(result.validForSigning).toBe(false);
    expect(result.statusAtTime).toBe('compromised');
  });

  it('does not invalidate signatures made well before the compromise grace window', () => {
    const history: KeyStatusEvent[] = [
      { status: 'active', effectiveAt: '2026-01-01T00:00:00Z' },
      { status: 'compromised', effectiveAt: '2026-06-10T00:00:00Z' },
    ];
    const result = evaluateKeyValidityAt(history, '2026-02-01T00:00:00Z', {
      compromiseGracePeriodMs: 24 * 60 * 60 * 1000,
    });
    expect(result.validForSigning).toBe(true);
    expect(result.statusAtTime).toBe('active');
  });

  it('sorts out-of-order history before evaluating', () => {
    const history: KeyStatusEvent[] = [
      { status: 'revoked', effectiveAt: '2026-06-01T00:00:00Z' },
      { status: 'active', effectiveAt: '2026-01-01T00:00:00Z' },
    ];
    expect(evaluateKeyValidityAt(history, '2026-03-01T00:00:00Z').validForSigning).toBe(true);
  });
});
