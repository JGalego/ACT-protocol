import { describe, expect, it } from 'vitest';
import { generateId } from '@act/core';
import { generateKeyPair } from '@act/crypto';
import { Ledger } from '../ledger.js';
import { SqliteAdapter } from '../sqlite-adapter.js';
import { UntrustedActorError } from '../errors.js';
import type { TrustPolicy } from '../types.js';
import type { LedgerReceipt } from '../receipts.js';
import { buildEvent, makeActor, publicKeysFor, signedEnvelope } from './helpers.js';

/**
 * An event that arrives with a source receipt is judged at that receipt's
 * `accepted_at` (ADR 0012), never at the moment it is imported and never at the
 * time the signer claims.
 */
describe('trust at the source acceptance time', () => {
  const T = (iso: string) => Date.parse(iso);
  const actor = makeActor();

  /** Key is valid from 10:00 up to (not including) 11:00. */
  const policy: TrustPolicy & { askedAt: string[] } = {
    askedAt: [],
    isTrusted: () => false, // "now" the key is retired
    isTrustedAt(_actorId, keyId, atIso) {
      this.askedAt.push(atIso);
      return (
        keyId === actor.signer.keyId &&
        T(atIso) >= T('2026-01-01T10:00:00Z') &&
        T(atIso) < T('2026-01-01T11:00:00Z')
      );
    },
  };

  async function ledger(trustPolicy: TrustPolicy) {
    const adapter = SqliteAdapter.open(':memory:');
    await adapter.migrate();
    const kp = generateKeyPair();
    return new Ledger({
      ledgerId: generateId(),
      adapter,
      signer: { keyId: kp.keyId, publicKey: kp.publicKey, privateKey: kp.privateKey },
      trustPolicy,
    });
  }
  const genesis = () =>
    signedEnvelope(
      buildEvent({
        actor,
        eventType: 'genesis',
        subject: {
          kind: 'artifact',
          artifact_id: generateId(),
          version_id: `sha-256:${'1'.repeat(64)}`,
        },
        // The signer claims a time inside the valid window; it must not matter.
        occurredAt: '2026-01-01T10:30:00Z',
      }),
      actor,
    );
  const receiptAt = (acceptedAt: string): LedgerReceipt => ({
    ledger_id: 'source',
    sequence: 0,
    event_id: 'x',
    accepted_at: acceptedAt,
    previous_receipt_digest: 'sha-256:' + '0'.repeat(64),
    receipt_digest: 'sha-256:' + '0'.repeat(64),
    signature: { key_id: 'k', algorithm: 'ed25519', signature: 'AA==' },
  });

  it('accepts an imported event the source accepted while the key was valid, though it is retired now', async () => {
    const l = await ledger(policy);
    const result = await l.appendEvent(genesis(), {
      publicKeys: publicKeysFor(actor),
      sourceReceipt: receiptAt('2026-01-01T10:30:00Z'),
    });
    expect(result.duplicate).toBe(false);
    expect(policy.askedAt.at(-1)).toBe('2026-01-01T10:30:00Z');
  });

  it('refuses an imported event the source accepted after the key stopped being valid, whatever time the signer claims', async () => {
    const l = await ledger(policy);
    await expect(
      l.appendEvent(genesis(), {
        publicKeys: publicKeysFor(actor),
        sourceReceipt: receiptAt('2026-01-01T12:00:00Z'),
      }),
    ).rejects.toThrow(UntrustedActorError);
  });

  it('refuses one the source accepted before the key existed', async () => {
    const l = await ledger(policy);
    await expect(
      l.appendEvent(genesis(), {
        publicKeys: publicKeysFor(actor),
        sourceReceipt: receiptAt('2026-01-01T09:00:00Z'),
      }),
    ).rejects.toThrow(UntrustedActorError);
  });

  it('still judges a native event at the moment it is accepted', async () => {
    const l = await ledger(policy);
    await expect(l.appendEvent(genesis(), { publicKeys: publicKeysFor(actor) })).rejects.toThrow(
      UntrustedActorError,
    );
  });

  it('falls back to the current verdict when the policy cannot answer for a past time', async () => {
    const l = await ledger({ isTrusted: () => true });
    await expect(
      l.appendEvent(genesis(), {
        publicKeys: publicKeysFor(actor),
        sourceReceipt: receiptAt('2026-01-01T12:00:00Z'),
      }),
    ).resolves.toMatchObject({ duplicate: false });
  });

  it('judges every co-signer at the same attested time', async () => {
    const co = makeActor();
    const timed: TrustPolicy = {
      isTrusted: () => false,
      isTrustedAt: (_a, keyId) => keyId === actor.signer.keyId,
      isKeyTrustedAt: (keyId, atIso) =>
        keyId === co.signer.keyId && T(atIso) < T('2026-01-01T11:00:00Z'),
    };
    const l = await ledger(timed);
    const envelopeFor = () =>
      signedEnvelope(
        buildEvent({
          actor,
          eventType: 'genesis',
          subject: {
            kind: 'artifact',
            artifact_id: generateId(),
            version_id: `sha-256:${'2'.repeat(64)}`,
          },
        }),
        actor,
      );
    // Re-sign with both keys.
    const { signEnvelope } = await import('@act/crypto');
    const both = signEnvelope(envelopeFor().payload as Record<string, unknown>, [
      actor.signer,
      co.signer,
    ]);
    const keys = publicKeysFor(actor, co);
    await expect(
      l.appendEvent(both, { publicKeys: keys, sourceReceipt: receiptAt('2026-01-01T10:00:00Z') }),
    ).resolves.toMatchObject({ duplicate: false });
    const second = signEnvelope(
      { ...(both.payload as Record<string, unknown>), occurred_at: '2026-01-01T09:00:00Z' },
      [actor.signer, co.signer],
    );
    await expect(
      l.appendEvent(second, { publicKeys: keys, sourceReceipt: receiptAt('2026-01-01T12:00:00Z') }),
    ).rejects.toThrow(UntrustedActorError);
  });
});
