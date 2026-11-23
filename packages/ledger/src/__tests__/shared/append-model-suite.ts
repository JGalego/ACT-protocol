import { describe, expect, it } from 'vitest';
import { generateId } from '@act/core';
import { generateKeyPair } from '@act/crypto';
import { Ledger } from '../../ledger.js';
import { verifyReceipt } from '../../receipts.js';
import type { StorageAdapter, StorageTransaction } from '../../storage-adapter.js';
import { allowlistTrustPolicy } from '../../types.js';
import { buildEvent, makeActor, publicKeysFor, signedEnvelope } from '../helpers.js';

/**
 * Randomized, fault-injecting test of the REAL append path on a real storage
 * engine, mirroring formal/modules/LedgerAppend.tla.
 *
 * Several workers submit events at once; some submit the same event (a client
 * retry racing its original). The adapter randomly "crashes" a statement inside
 * the transaction, after earlier statements of that transaction have run, which
 * is the model's crash at any step. Clients retry. Afterwards the model's
 * invariants are checked against what is actually stored:
 *
 *   ReceiptChainIntegrity   sequences 0..n-1 with no gap or repeat, each receipt
 *                           naming its predecessor's digest, all validly signed;
 *   NoDuplicateReceipts     an event has at most one receipt;
 *   AtomicEventAndReceipt   the stored events and the receipted events are the same set.
 * and the outcomes agree: an event that any attempt was told succeeded is stored
 * exactly once; one that never succeeded is not stored at all.
 */

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const FAULT_POINTS = new Set(['insertEvent', 'insertCausalParent', 'insertReceipt', 'upsertHead']);

/** Wraps an adapter so statements inside a transaction can fail at random. */
function flaky(adapter: StorageAdapter, rand: () => number, probability: number): StorageAdapter {
  return new Proxy(adapter, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (prop !== 'withTransaction')
        return typeof value === 'function' ? value.bind(target) : value;
      return <T>(fn: (tx: StorageTransaction) => Promise<T>) =>
        target.withTransaction((tx) =>
          fn(
            new Proxy(tx, {
              get(t, name) {
                const member = Reflect.get(t, name, t);
                if (typeof member !== 'function') return member;
                if (!FAULT_POINTS.has(String(name))) return member.bind(t);
                return async (...args: unknown[]) => {
                  if (rand() < probability) throw new Error('injected crash');
                  return member.apply(t, args);
                };
              },
            }),
          ),
        );
    },
  });
}

export function registerAppendModelSuite(
  dialectName: string,
  makeAdapter: () => Promise<StorageAdapter>,
  cleanup?: (adapter: StorageAdapter) => Promise<void>,
): void {
  describe(`append path under concurrency and crashes [${dialectName}]`, () => {
    const RUNS = 12;
    for (let seed = 1; seed <= RUNS; seed++) {
      it(`seed ${seed}`, async () => {
        const rand = rng(seed * 7727);
        const adapter = await makeAdapter();
        try {
          const actor = makeActor();
          const kp = generateKeyPair();
          const ledger = new Ledger({
            ledgerId: generateId(),
            adapter: flaky(adapter, rand, 0.25),
            signer: { keyId: kp.keyId, publicKey: kp.publicKey, privateKey: kp.privateKey },
            trustPolicy: allowlistTrustPolicy([actor.signer.keyId]),
          });

          const pool = Array.from({ length: 3 }, () =>
            signedEnvelope(
              buildEvent({
                actor,
                eventType: 'genesis',
                subject: {
                  kind: 'artifact',
                  artifact_id: generateId(),
                  version_id: `sha-256:${'1'.repeat(64)}`,
                },
              }),
              actor,
            ),
          );
          const succeeded = new Set<string>();
          const attempted = new Set<string>();

          const WORKERS = 6;
          await Promise.all(
            Array.from({ length: WORKERS }, async () => {
              const envelope = pool[Math.floor(rand() * pool.length)]!;
              attempted.add(envelope.payloadDigest);
              // A client that is told it failed simply tries again, a few times.
              for (let attempt = 0; attempt < 4; attempt++) {
                try {
                  await ledger.appendEvent(envelope, { publicKeys: publicKeysFor(actor) });
                  succeeded.add(envelope.payloadDigest);
                  return;
                } catch {
                  // injected crash or lost race: retry
                }
              }
            }),
          );

          const receipts = await ledger.listReceipts(-1, 1000);
          const events = await ledger.listEvents(1000, -1);
          const message = `seed ${seed}: receipts=${receipts.length} events=${events.length}`;

          // ReceiptChainIntegrity
          expect(
            receipts.map((r) => r.sequence),
            message,
          ).toEqual(receipts.map((_, i) => i));
          receipts.forEach((r, i) => {
            const check = verifyReceipt(r, kp.publicKey, i === 0 ? null : receipts[i - 1]!);
            expect(check, `${message} receipt ${i}`).toEqual({
              digestValid: true,
              signatureValid: true,
              chainLinkValid: true,
            });
          });
          // NoDuplicateReceipts
          const receipted = receipts.map((r) => r.event_id);
          expect(new Set(receipted).size, message).toBe(receipted.length);
          // AtomicEventAndReceipt
          expect(new Set(events.map((e) => e.eventId)), message).toEqual(new Set(receipted));
          // Outcomes agree with storage.
          for (const id of succeeded) expect(receipted, message).toContain(id);
          for (const id of receipted) expect(attempted.has(id), message).toBe(true);
          for (const id of attempted) {
            if (!succeeded.has(id)) {
              // Never told it succeeded: either never committed, or committed by a concurrent twin.
              expect(receipted.filter((r) => r === id).length, message).toBeLessThanOrEqual(1);
            }
          }
        } finally {
          if (cleanup) await cleanup(adapter);
        }
      }, 60_000);
    }
  });
}
