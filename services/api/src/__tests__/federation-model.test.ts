import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { generateId } from '@act/core';
import { signEnvelope } from '@act/crypto';
import { buildUnsignedEvent } from '@act/sdk';
import { buildServer } from '../server.js';
import { createLedgerContext, type LedgerContext } from '../ledger-context.js';
import { buildExportBundle, importBundle } from '../bundle-ops.js';
import {
  buildKeyRegistrationEnvelope,
  makeActor,
  peerRegistrationBody,
  resignBundle,
  type TestActor,
} from './helpers.js';

/**
 * Stateful adversarial test of federation import against the REAL import code,
 * mirroring formal/modules/Federation.tla.
 *
 * A destination ledger has pinned one honest source, S. S accepts a chain
 * k1 <- e2 <- e3. A network adversary hands the destination bundles in any order:
 * genuine ones (whole or with events omitted, declaring the gaps correctly,
 * wrongly, or not at all), tampered ones, one forged under the adversary's own
 * ledger (self-consistent, with valid signatures and receipts), and one claiming
 * to be from S but signed by the adversary. For every bundle the real
 * `importBundle` is compared with the model's guards, and after every step the
 * model's invariants are re-checked against the destination's own ledger:
 *
 *   NoForgedEvents    the destination only holds events S really accepted;
 *   NoUndeclaredGaps  a missing parent is accepted only where the bundle declared it;
 *   BoundaryAccurate  recorded missing-parent boundaries are exactly the pairs that exist.
 */

const CHAIN = ['k1', 'e2', 'e3'] as const;
type Name = (typeof CHAIN)[number];
const PARENT: Record<Name, Name | null> = { k1: null, e2: 'k1', e3: 'e2' };

interface World {
  src: { server: FastifyInstance; ctx: LedgerContext };
  dst: { server: FastifyInstance; ctx: LedgerContext };
  mal: { server: FastifyInstance; ctx: LedgerContext };
  alice: TestActor;
  /** What S has accepted: name -> event id, in chain order. */
  accepted: Map<Name, string>;
  /** What the destination holds from S: names. */
  local: Set<Name>;
  steps: string[];
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
type Rand = () => number;
const pick = <T>(rand: Rand, xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;

const hdr = (who: string) => ({ authorization: `Bearer ${who}` });

async function ledger() {
  const ctx = await createLedgerContext(':memory:');
  const server = await buildServer({ devMode: true, ledgerContext: ctx });
  return { server, ctx };
}

function chainEvent(actor: TestActor, parentEventId: string) {
  return signEnvelope(
    buildUnsignedEvent({
      eventType: 'external_import',
      actor: { actorId: actor.actorId, keyId: actor.signer.keyId },
      tenant: 'default',
      subject: { kind: 'artifact', artifact_id: generateId() },
      causalParents: [{ event_id: parentEventId, relation: 'input' }],
      payload: { note: generateId() },
    }),
    [actor.signer],
  );
}

async function newWorld(): Promise<World> {
  const [src, dst, mal] = [await ledger(), await ledger(), await ledger()];
  const alice = makeActor();
  // The destination already knows alice before anything the source does, so trust is not what is being tested.
  for (const l of [dst, src, mal]) {
    const res = await l.server.inject({
      method: 'POST',
      url: '/v1/keys',
      headers: hdr(alice.actorId),
      payload: buildKeyRegistrationEnvelope(alice),
    });
    expect(res.statusCode).toBe(201);
  }
  const pin = await dst.server.inject({
    method: 'POST',
    url: '/v1/federation/peers',
    headers: hdr('admin'),
    payload: peerRegistrationBody('http://127.0.0.1:9', src.ctx),
  });
  expect(pin.statusCode).toBe(201);

  // k1 is alice's registration on S (its first event); e2 and e3 follow.
  const k1 = (await src.ctx.ledger.listEvents(1, -1))[0]!;
  const w: World = {
    src,
    dst,
    mal,
    alice,
    accepted: new Map([['k1', k1.eventId]]),
    local: new Set(),
    steps: [],
  };
  // The adversary's own ledger: a chain of its own, signed by the same alice.
  const malAnchor = (await mal.ctx.ledger.listEvents(1, -1))[0]!;
  const forged = await mal.server.inject({
    method: 'POST',
    url: '/v1/artifacts',
    headers: hdr(alice.actorId),
    payload: chainEvent(alice, malAnchor.eventId),
  });
  expect(forged.statusCode).toBe(201);
  return w;
}

async function close(w: World) {
  await Promise.all([w.src.server.close(), w.dst.server.close(), w.mal.server.close()]);
}

// --------------------------------------------------------------------- actions

/** Federation.tla `SourceAccepts`: S accepts the next event of its chain, parents first. */
async function actSourceAccepts(w: World) {
  const next = CHAIN.find((n) => !w.accepted.has(n));
  if (!next) return;
  const parent = w.accepted.get(PARENT[next]!)!;
  const res = await w.src.server.inject({
    method: 'POST',
    url: '/v1/artifacts',
    headers: hdr(w.alice.actorId),
    payload: chainEvent(w.alice, parent),
  });
  expect(res.statusCode, w.steps.join('\n')).toBe(201);
  w.accepted.set(next, res.json().eventId);
  w.steps.push(`sourceAccepts(${next})`);
}

type BundleKind =
  'genuine' | 'tampered' | 'forged-own-ledger' | 'claims-source-signed-by-adversary';
type GapStyle = 'correct' | 'none' | 'wrong';

/** Federation.tla `Import`: one adversarial delivery, then the guards and invariants. */
async function actDeliver(w: World, rand: Rand) {
  const kind = pick(rand, [
    'genuine',
    'genuine',
    'genuine',
    'tampered',
    'forged-own-ledger',
    'claims-source-signed-by-adversary',
  ] as const satisfies readonly BundleKind[]);
  const style = pick(rand, [
    'correct',
    'correct',
    'none',
    'wrong',
  ] as const satisfies readonly GapStyle[]);

  if (kind === 'forged-own-ledger') {
    // Self-consistent: M's own events, receipts and signature. Not from the pinned peer.
    const bundle = await buildExportBundle(w.mal.ctx);
    const before = w.local.size;
    await expect(
      importBundle(w.dst.ctx, bundle as never),
      w.steps.join('\n'),
    ).rejects.toMatchObject({
      status: 403,
    });
    w.steps.push(`deliver(forged-own-ledger) -> rejected`);
    expect(w.local.size).toBe(before);
    return;
  }

  const full = (await buildExportBundle(w.src.ctx)) as Record<string, any>;
  // A random subset of S's events, in S's order.
  const keep = CHAIN.filter((n) => w.accepted.has(n) && rand() < 0.7);
  const idOf = (n: Name) => w.accepted.get(n)!;
  const events = full.events.filter((e: { signed_envelope: { payloadDigest: string } }) =>
    keep.some((n) => idOf(n) === e.signed_envelope.payloadDigest),
  );
  // What the bundle declares missing: correct = every omitted parent, none, or a wrong id.
  const omittedParents = keep
    .filter((n) => PARENT[n] && !keep.includes(PARENT[n]!))
    .map((n) => ({ missing_event_id: idOf(PARENT[n]!), referenced_by: idOf(n) }));
  const declared =
    style === 'correct'
      ? omittedParents
      : style === 'wrong'
        ? omittedParents.map((g) => ({ ...g, missing_event_id: `sha-256:${'7'.repeat(64)}` }))
        : [];
  const body = {
    ...full,
    events,
    completeness: {
      scope: omittedParents.length > 0 ? 'partial' : 'complete',
      known_gaps: declared,
    },
  };

  let bundle: Record<string, any>;
  if (kind === 'genuine') bundle = resignBundle(w.src.ctx, body);
  else if (kind === 'tampered') {
    bundle = { ...resignBundle(w.src.ctx, body), exported_at: '2001-01-01T00:00:00.000Z' };
  } else {
    bundle = resignBundle(w.mal.ctx, { ...body, source_ledger_id: w.src.ctx.ledgerId });
  }

  if (kind !== 'genuine') {
    const before = w.local.size;
    await expect(
      importBundle(w.dst.ctx, bundle as never),
      w.steps.join('\n'),
    ).rejects.toBeDefined();
    w.steps.push(`deliver(${kind}) -> rejected`);
    expect(w.local.size).toBe(before);
    return;
  }

  // Predict, event by event, in bundle order (Federation.tla `Import`).
  const expectedQuarantined: string[] = [];
  const declaredFor = (child: Name) =>
    declared.some(
      (g) => g.referenced_by === idOf(child) && g.missing_event_id === idOf(PARENT[child]!),
    );
  const projected = new Set(w.local);
  for (const n of keep) {
    if (projected.has(n)) continue; // a duplicate: a no-op
    const parent = PARENT[n];
    const missing = parent !== null && !projected.has(parent);
    if (missing && !declaredFor(n)) expectedQuarantined.push(idOf(n));
    else projected.add(n);
  }

  const result = await importBundle(w.dst.ctx, bundle as never);
  w.steps.push(
    `deliver(genuine keep=[${keep}] gaps=${style}) -> quarantined ${result.quarantined.length}`,
  );
  expect([...result.quarantined].sort(), `${w.steps.join('\n')}`).toEqual(
    expectedQuarantined.sort(),
  );
  w.local = projected;
}

// ------------------------------------------------------------------ invariants

async function checkInvariants(w: World) {
  const held = new Map<string, Name>();
  for (const [n, id] of w.accepted) held.set(id, n);
  const events = await w.dst.ctx.ledger.listEvents(500, -1);
  const message = w.steps.join('\n');

  // NoForgedEvents: everything held besides the destination's own key registration came from S.
  const foreign = events.filter((e) => held.has(e.eventId));
  const native = events.filter((e) => !held.has(e.eventId));
  expect(native, message).toHaveLength(1);
  expect(new Set(foreign.map((e) => held.get(e.eventId))), message).toEqual(w.local);

  // BoundaryAccurate: a boundary exists exactly where a held event's parent is not held.
  for (const e of foreign) {
    const name = held.get(e.eventId)!;
    const parent = PARENT[name];
    const lineage = await w.dst.ctx.ledger.getLineage(e.eventId, 1);
    const expectBoundary = parent !== null && !w.local.has(parent);
    expect(lineage.boundaries.length > 0, `${name} boundary\n${message}`).toBe(expectBoundary);
  }
}

// ------------------------------------------------------------------------ runner

describe('federation import: stateful adversarial test against the real code', () => {
  const RUNS = 25;
  const STEPS = 14;
  for (let seed = 1; seed <= RUNS; seed++) {
    it(`seed ${seed}`, async () => {
      const rand = rng(seed * 104729);
      const w = await newWorld();
      try {
        for (let i = 0; i < STEPS; i++) {
          if (rand() < 0.35) await actSourceAccepts(w);
          else await actDeliver(w, rand);
          await checkInvariants(w);
        }
      } finally {
        await close(w);
      }
    }, 60_000);
  }
});
