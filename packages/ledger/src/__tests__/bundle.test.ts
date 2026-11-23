import { describe, expect, it } from 'vitest';
import { canonicalize, digestBytes, digestCanonicalValue, generateId } from '@act/core';
import { generateKeyPair, signBytes, signEnvelope } from '@act/crypto';
import {
  computeKnownGaps,
  gapsByReferencingEvent,
  parseSelfRegisteredKey,
  sourceReceiptProblem,
  verifyBundleIntegrity,
} from '../bundle.js';
import { GENESIS_RECEIPT_DIGEST, issueReceipt } from '../receipts.js';
import { buildEvent, makeActor } from './helpers.js';

const ledgerKey = generateKeyPair();
const trusted = { keyId: ledgerKey.keyId, publicKey: ledgerKey.publicKey };

function makeBundle(overrides: Record<string, unknown> = {}) {
  const body = {
    source_ledger_id: generateId(),
    exported_at: '2026-07-16T00:00:00Z',
    events: [],
    completeness: { scope: 'complete', known_gaps: [] },
    ...overrides,
  };
  const bundleId = digestCanonicalValue(body);
  return {
    bundle_id: bundleId,
    ...body,
    signature: {
      key_id: ledgerKey.keyId,
      algorithm: 'ed25519' as const,
      signature: signBytes(
        ledgerKey.privateKey,
        ledgerKey.publicKey,
        new TextEncoder().encode(bundleId),
      ),
    },
  };
}

describe('verifyBundleIntegrity', () => {
  it('accepts a bundle whose id matches its body and is signed by the trusted key', () => {
    expect(verifyBundleIntegrity(makeBundle(), trusted)).toEqual({ ok: true });
  });

  it('rejects a bundle whose body was changed after the id was computed', () => {
    const bundle = { ...makeBundle(), exported_at: '2031-01-01T00:00:00Z' };
    expect(verifyBundleIntegrity(bundle, trusted)).toMatchObject({
      ok: false,
      code: 'bundle_digest_mismatch',
    });
  });

  it('rejects a bundle signed by a different key, or with a corrupted signature', () => {
    const other = generateKeyPair();
    expect(
      verifyBundleIntegrity(makeBundle(), { keyId: other.keyId, publicKey: other.publicKey }),
    ).toMatchObject({ ok: false, code: 'invalid_bundle_signature' });
    const bundle = makeBundle();
    bundle.signature.signature = Buffer.from('not a signature').toString('base64');
    expect(verifyBundleIntegrity(bundle, trusted)).toMatchObject({
      ok: false,
      code: 'invalid_bundle_signature',
    });
  });
});

describe('sourceReceiptProblem', () => {
  const ledgerId = generateId();
  const actor = makeActor();
  const envelope = signEnvelope(
    buildEvent({
      actor,
      eventType: 'genesis',
      subject: { kind: 'artifact', artifact_id: generateId() },
    }),
    [actor.signer],
  );
  const expected = { ledgerId, ...trusted };
  const receiptAt = (sequence: number, previous: string, eventId = envelope.payloadDigest) =>
    issueReceipt(
      {
        ledger_id: ledgerId,
        sequence,
        event_id: eventId,
        accepted_at: '2026-07-16T00:00:00Z',
        previous_receipt_digest: previous,
      },
      ledgerKey,
    );

  it('accepts a genuine sequence-0 receipt', () => {
    expect(
      sourceReceiptProblem(receiptAt(0, GENESIS_RECEIPT_DIGEST), null, envelope, expected),
    ).toBeNull();
  });

  it('checks the chain link only when the predecessor is present', () => {
    const first = receiptAt(0, GENESIS_RECEIPT_DIGEST);
    const second = receiptAt(1, first.receipt_digest);
    expect(sourceReceiptProblem(second, first, envelope, expected)).toBeNull();
    // A filtered export may skip receipts: no predecessor, no link check.
    expect(
      sourceReceiptProblem(receiptAt(7, `sha-256:${'9'.repeat(64)}`), null, envelope, expected),
    ).toBeNull();
    // But a present predecessor that does not match is a broken chain.
    expect(
      sourceReceiptProblem(receiptAt(1, `sha-256:${'9'.repeat(64)}`), first, envelope, expected),
    ).toMatch(/chain/);
    // A sequence-0 receipt must chain to the genesis constant.
    expect(
      sourceReceiptProblem(receiptAt(0, `sha-256:${'9'.repeat(64)}`), null, envelope, expected),
    ).toMatch(/chain/);
  });

  it('rejects a receipt from another ledger, for another event, or by another key', () => {
    const base = receiptAt(0, GENESIS_RECEIPT_DIGEST);
    expect(
      sourceReceiptProblem(base, null, envelope, { ...expected, ledgerId: generateId() }),
    ).toMatch(/different ledger/);
    expect(
      sourceReceiptProblem(
        receiptAt(0, GENESIS_RECEIPT_DIGEST, `sha-256:${'1'.repeat(64)}`),
        null,
        envelope,
        expected,
      ),
    ).toMatch(/different event/);
    const stranger = generateKeyPair();
    const forged = issueReceipt(
      {
        ledger_id: ledgerId,
        sequence: 0,
        event_id: envelope.payloadDigest,
        accepted_at: '2026-07-16T00:00:00Z',
        previous_receipt_digest: GENESIS_RECEIPT_DIGEST,
      },
      stranger,
    );
    expect(sourceReceiptProblem(forged, null, envelope, expected)).toMatch(/unexpected key/);
  });

  it('rejects a receipt whose contents or signature were tampered with', () => {
    const base = receiptAt(0, GENESIS_RECEIPT_DIGEST);
    expect(
      sourceReceiptProblem(
        { ...base, accepted_at: '2031-01-01T00:00:00Z' },
        null,
        envelope,
        expected,
      ),
    ).toMatch(/digest/);
    expect(
      sourceReceiptProblem(
        {
          ...base,
          signature: { ...base.signature, signature: Buffer.from('x').toString('base64') },
        },
        null,
        envelope,
        expected,
      ),
    ).toMatch(/signature/);
  });
});

describe('known gaps', () => {
  it('lists every parent an included event names that the bundle leaves out', () => {
    const gaps = computeKnownGaps([
      { eventId: 'a', parentEventIds: [] },
      { eventId: 'b', parentEventIds: ['a', 'missing-1'] },
      { eventId: 'c', parentEventIds: ['missing-1', 'missing-2'] },
    ]);
    expect(gaps).toEqual([
      { missing_event_id: 'missing-1', referenced_by: 'b' },
      { missing_event_id: 'missing-1', referenced_by: 'c' },
      { missing_event_id: 'missing-2', referenced_by: 'c' },
    ]);
    expect(computeKnownGaps([{ eventId: 'a', parentEventIds: [] }])).toEqual([]);
  });

  it('groups declared gaps by the event that referenced them', () => {
    expect(
      gapsByReferencingEvent([
        { missing_event_id: 'm1', referenced_by: 'b' },
        { missing_event_id: 'm2', referenced_by: 'b' },
        { missing_event_id: 'm1', referenced_by: 'c' },
      ]),
    ).toEqual(
      new Map([
        ['b', ['m1', 'm2']],
        ['c', ['m1']],
      ]),
    );
  });
});

describe('parseSelfRegisteredKey', () => {
  function keyEvent(
    overrides: {
      dataPatch?: Record<string, unknown>;
      eventType?: string;
      artifactType?: string;
    } = {},
    signWith = generateKeyPair(),
    actorPatch: Record<string, string> = {},
  ) {
    const ownerActorId = generateId();
    const unsigned = {
      artifact_type: overrides.artifactType ?? 'Key',
      data: {
        key_id: signWith.keyId,
        algorithm: 'ed25519',
        public_key: signWith.publicKey,
        status: 'active',
        owner_actor_id: ownerActorId,
        ...overrides.dataPatch,
      },
    };
    const event = {
      ...buildEvent({
        actor: { actorId: ownerActorId, signer: { ...signWith, keyId: signWith.keyId } },
        eventType: overrides.eventType ?? 'genesis',
        subject: { kind: 'artifact', artifact_id: generateId() },
        payload: unsigned,
      }),
    };
    const patched = { ...event, actor: { ...(event.actor as object), ...actorPatch } };
    return {
      envelope: signEnvelope(patched, [signWith]),
      ownerActorId,
      keyPair: signWith,
    };
  }

  it('accepts a key that is its own fingerprint, signs its own registration, and is owned by its author', () => {
    const { envelope, ownerActorId, keyPair } = keyEvent();
    expect(parseSelfRegisteredKey(envelope)).toEqual({
      keyId: keyPair.keyId,
      publicKey: keyPair.publicKey,
      ownerActorId,
    });
  });

  it.each([
    ['not a key artifact', { artifactType: 'Task' }],
    ['not a registration event type', { eventType: 'artifact_revised' }],
    ['status other than issued/active', { dataPatch: { status: 'revoked' } }],
    ['key id that is not the fingerprint', { dataPatch: { key_id: `ed25519:${'0'.repeat(64)}` } }],
    ['missing owner', { dataPatch: { owner_actor_id: '' } }],
  ])('returns null for %s', (_label, overrides) => {
    expect(parseSelfRegisteredKey(keyEvent(overrides).envelope)).toBeNull();
  });

  it("returns null when the author is not the owner, or the signature is not the key's own", () => {
    expect(
      parseSelfRegisteredKey(keyEvent({}, generateKeyPair(), { actor_id: generateId() }).envelope),
    ).toBeNull();
    const a = generateKeyPair();
    const b = generateKeyPair();
    const claimsB = keyEvent({}, b);
    const resigned = signEnvelope(claimsB.envelope.payload, [
      { keyId: b.keyId, publicKey: a.publicKey, privateKey: a.privateKey },
    ]);
    expect(parseSelfRegisteredKey(resigned)).toBeNull();
  });
});

// Keep canonicalize/digestBytes imports meaningful if a case above is removed.
void canonicalize;
void digestBytes;
