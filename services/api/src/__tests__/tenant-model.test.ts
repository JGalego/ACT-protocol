import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { generateId } from '@act/core';
import { generateKeyPair, signEnvelope } from '@act/crypto';
import { buildUnsignedEvent } from '@act/sdk';
import { buildServer } from '../server.js';
import { createLedgerContext, type LedgerContext } from '../ledger-context.js';
import {
  buildKeyRegistrationEnvelope,
  makeActor,
  peerRegistrationBody,
  withTenant,
  type TestActor,
} from './helpers.js';

/**
 * Stateful adversarial test of tenant isolation against the REAL API.
 *
 * formal/modules/TenantIsolation.tla model-checks tenants that attack each
 * other through a shared store. This test plays that adversary against the
 * actual handlers: two tenants register the same keys, submit events naming any
 * tenant and any parent, read, list peers, pin each other and import bundles,
 * in seeded random order. For every action the API's accept/reject is compared
 * with a reference model that knows only each tenant's *own* history (the
 * "ideal" of the TLA+ model), and after every step the invariants are re-checked
 * from the ledgers' own contents:
 *
 *   - responses never depend on another tenant (duplicates, parents, reads,
 *     peers, sequence numbers);
 *   - every native event in a ledger names that ledger's tenant and was signed
 *     by a key in that ledger's own registry;
 *   - each ledger's receipt chain is gap-free and hash-linked on its own;
 *   - a ledger holds imported events only from a ledger its administrators pinned;
 *   - an administrator scoped to one tenant is not one in another.
 */

const TENANTS = ['acme', 'globex'] as const;
type Tenant = (typeof TENANTS)[number];
const KEYS = ['k1', 'k2'] as const;
type KeyName = (typeof KEYS)[number];
const CALLERS = ['alice', 'root', 'mallory'] as const;
type Caller = (typeof CALLERS)[number];
/** ACT_ADMIN_ACTORS = acme::alice,root */
const ADMINS = ['acme::alice', 'root'];
const idealAdmin = (t: Tenant, a: Caller) => a === 'root' || (a === 'alice' && t === 'acme');
const other = (t: Tenant): Tenant => (t === 'acme' ? 'globex' : 'acme');

interface World {
  server: FastifyInstance;
  ctx: LedgerContext;
  who: Record<KeyName, TestActor>;
  /** What each tenant has really done: its own history, as the reference model sees it. */
  registered: Record<Tenant, Set<KeyName>>;
  /** Event ids a tenant's ledger accepted natively (from 201 responses). */
  native: Record<Tenant, Set<string>>;
  /** Event ids a tenant's ledger holds because it imported them. */
  imported: Record<Tenant, Set<string>>;
  peers: Record<Tenant, number>;
  pinned: Record<Tenant, Set<Tenant>>;
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

const hdr = (t: Tenant, who: string) => ({ authorization: `Bearer ${who}`, 'x-act-tenant': t });
const call = (
  w: World,
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  t: Tenant,
  who: string,
  payload?: unknown,
) =>
  w.server.inject({
    method,
    url,
    headers: hdr(t, who),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

async function newWorld(): Promise<World> {
  const ctx = await createLedgerContext(':memory:');
  const server = await buildServer({ devMode: true, ledgerContext: ctx, adminActorIds: ADMINS });
  return {
    server,
    ctx,
    who: { k1: makeActor(), k2: makeActor() },
    registered: { acme: new Set(), globex: new Set() },
    native: { acme: new Set(), globex: new Set() },
    imported: { acme: new Set(), globex: new Set() },
    peers: { acme: 0, globex: 0 },
    pinned: { acme: new Set(), globex: new Set() },
    steps: [],
  };
}

const ownIds = (w: World, t: Tenant) => new Set([...w.native[t], ...w.imported[t]]);

// --------------------------------------------------------------------- actions

/** TenantIsolation.tla `Register`: any tenant may register any key it holds; another tenant's registry never shows. */
async function actRegister(w: World, rand: Rand) {
  const t = pick(rand, TENANTS);
  const k = pick(rand, KEYS);
  const actor = w.who[k];
  const res = await call(
    w,
    'POST',
    '/v1/keys',
    t,
    actor.actorId,
    withTenant(t, () => buildKeyRegistrationEnvelope(actor)),
  );
  w.steps.push(`register(${t}, ${k}) -> ${res.statusCode}`);
  expect(res.statusCode, `${w.steps.join('\n')}\n${res.body}`).toBe(201);
  w.registered[t].add(k);
  w.native[t].add(res.json().eventId as string);
}

/** TenantIsolation.tla `Submit`: any key, any claimed tenant, any parent. */
async function actSubmit(w: World, rand: Rand) {
  const t = pick(rand, TENANTS);
  const k = pick(rand, KEYS);
  const claim: Tenant | 'na' = pick(rand, [...TENANTS, 'na'] as const);
  const parentKind = pick(rand, ['none', 'own', 'foreign', 'unknown'] as const);
  const own = [...w.native[t]];
  const foreign = [...w.native[other(t)]].filter((id) => !ownIds(w, t).has(id));
  let parent: string | undefined;
  if (parentKind === 'own') parent = own.length ? pick(rand, own) : undefined;
  else if (parentKind === 'foreign') parent = foreign.length ? pick(rand, foreign) : undefined;
  else if (parentKind === 'unknown') parent = `sha-256:${'9'.repeat(64)}`;
  // The ledger never accepts an event without a parent unless it is a genesis; keep one anchor.
  const anchor = own[0];
  const parents = parent ? [parent] : anchor && parentKind === 'none' ? [anchor] : [];
  if (parents.length === 0) return;

  const actor = w.who[k];
  const event = buildUnsignedEvent({
    eventType: 'external_import',
    actor: { actorId: actor.actorId, keyId: actor.signer.keyId },
    tenant: claim === 'na' ? { not_applicable: true, reason: 'test' } : claim,
    subject: { kind: 'artifact', artifact_id: generateId() },
    causalParents: parents.map((event_id) => ({ event_id, relation: 'input' })),
    payload: { source: 'tenant model test', note: generateId() },
  });
  const envelope = signEnvelope(event, [actor.signer]);
  const parentIsOwn = parents.every((p) => ownIds(w, t).has(p));
  const predicted = w.registered[t].has(k) && claim === t && parentIsOwn;
  const res = await call(w, 'POST', '/v1/artifacts', t, actor.actorId, envelope);
  w.steps.push(
    `submit(${t}, ${k}, claim=${claim}, parent=${parentKind}) predicted=${predicted} -> ${res.statusCode}`,
  );
  expect(
    res.statusCode === 201,
    `API disagrees with the model\n${w.steps.join('\n')}\n${res.body}`,
  ).toBe(predicted);
  if (res.statusCode === 201) w.native[t].add(res.json().eventId as string);

  // A parent that exists only in another tenant must be indistinguishable from one that exists nowhere.
  if (parentKind === 'foreign' && w.registered[t].has(k) && claim === t) {
    const fake = signEnvelope(
      buildUnsignedEvent({
        eventType: 'external_import',
        actor: { actorId: actor.actorId, keyId: actor.signer.keyId },
        tenant: t,
        subject: { kind: 'artifact', artifact_id: generateId() },
        causalParents: [{ event_id: `sha-256:${'8'.repeat(64)}`, relation: 'input' }],
        payload: { note: generateId() },
      }),
      [actor.signer],
    );
    const nowhere = await call(w, 'POST', '/v1/artifacts', t, actor.actorId, fake);
    expect([res.statusCode, res.json().code], w.steps.join('\n')).toEqual([
      nowhere.statusCode,
      nowhere.json().code,
    ]);
  }
}

/** TenantIsolation.tla `Read`: an id is visible to exactly the tenant whose ledger holds it. */
async function actRead(w: World, rand: Rand) {
  const t = pick(rand, TENANTS);
  const pool = [...w.native.acme, ...w.native.globex];
  if (pool.length === 0) return;
  const id = pick(rand, pool);
  const res = await call(w, 'GET', `/v1/lineage/${encodeURIComponent(id)}`, t, 'reader');
  const predicted = ownIds(w, t).has(id) ? 200 : 404;
  w.steps.push(`read(${t}, ${id.slice(0, 14)}…) predicted=${predicted} -> ${res.statusCode}`);
  expect(res.statusCode, w.steps.join('\n')).toBe(predicted);
}

/** TenantIsolation.tla `AddPeer` / `Pin` / `ListPeers`. */
async function actAddPeer(w: World, rand: Rand) {
  const t = pick(rand, TENANTS);
  const a = pick(rand, CALLERS);
  const pinTarget = rand() < 0.5 ? other(t) : undefined;
  let body: Record<string, unknown>;
  if (pinTarget) {
    body = peerRegistrationBody('http://127.0.0.1:9', await w.ctx.registry.get(pinTarget));
  } else {
    const kp = generateKeyPair();
    body = {
      url: 'http://127.0.0.1:9',
      ledgerId: generateId(),
      ledgerKeyId: kp.keyId,
      ledgerPublicKey: kp.publicKey,
    };
  }
  const res = await call(w, 'POST', '/v1/federation/peers', t, a, body);
  const predicted = idealAdmin(t, a);
  w.steps.push(
    `addPeer(${t}, ${a}, pin=${pinTarget ?? '-'}) predicted=${predicted} -> ${res.statusCode}`,
  );
  expect(res.statusCode === 201, `${w.steps.join('\n')}\n${res.body}`).toBe(predicted);
  if (res.statusCode === 201) {
    w.peers[t]++;
    if (pinTarget) w.pinned[t].add(pinTarget);
  }
  const listed = await call(w, 'GET', '/v1/federation/peers', t, 'root');
  expect((listed.json().items as unknown[]).length, w.steps.join('\n')).toBe(w.peers[t]);
}

/** TenantIsolation.tla `Import`: another tenant's events arrive only through a bundle from a pinned peer. */
async function actImport(w: World, rand: Rand) {
  const t = pick(rand, TENANTS);
  const u = other(t);
  const exported = await call(w, 'POST', '/v1/bundles/export', u, 'root', {});
  expect(exported.statusCode).toBe(200);
  const res = await call(w, 'POST', '/v1/bundles/import', t, 'root', exported.json());
  const predicted = w.pinned[t].has(u);
  w.steps.push(`import(${t} <- ${u}) pinned=${predicted} -> ${res.statusCode}`);
  expect(res.statusCode === 200, `${w.steps.join('\n')}\n${res.body}`).toBe(predicted);
  if (res.statusCode === 200) {
    const summary = res.json() as { accepted: number; quarantined: string[] };
    expect(summary.quarantined, w.steps.join('\n')).toEqual([]);
    for (const e of exported.json().events as { signed_envelope: { payloadDigest: string } }[]) {
      const id = e.signed_envelope.payloadDigest;
      if (!w.native[t].has(id)) w.imported[t].add(id);
    }
  }
}

// ------------------------------------------------------------------ invariants

async function allEvents(w: World, t: Tenant) {
  const out: {
    eventId: string;
    sequence: number;
    ledgerId: string;
    envelope: { payload: { tenant: unknown; actor: { key_id: string } } };
  }[] = [];
  let cursor = '';
  for (;;) {
    const res = await call(w, 'GET', `/v1/events?limit=500${cursor}`, t, 'reader');
    const page = res.json();
    out.push(...page.items);
    if (!page.nextCursor) return out;
    cursor = `&cursor=${page.nextCursor}`;
  }
}

async function checkInvariants(w: World) {
  const ledgerIds = new Set<string>();
  for (const t of TENANTS) {
    const ctx = await w.ctx.registry.get(t);
    ledgerIds.add(ctx.ledgerId);
    const events = await allEvents(w, t);
    const message = `tenant ${t}\n${w.steps.join('\n')}`;

    // Only this tenant's own history is visible, and nothing of it is missing.
    expect(new Set(events.map((e) => e.eventId)), message).toEqual(ownIds(w, t));
    // Its receipt chain is gap-free and its own.
    expect(
      events.map((e) => e.sequence),
      message,
    ).toEqual(events.map((_, i) => i));
    if (events.length > 0) {
      expect(new Set(events.map((e) => e.ledgerId)), message).toEqual(new Set([ctx.ledgerId]));
    }
    let previous: string | null = null;
    for (const e of events) {
      const receipt = await ctx.ledger.getReceipt(e.sequence);
      if (previous !== null) expect(receipt!.previous_receipt_digest, message).toBe(previous);
      previous = receipt!.receipt_digest;
    }
    // Native events name this tenant and were signed under a key this tenant registered.
    for (const e of events.filter((x) => w.native[t].has(x.eventId))) {
      expect(e.envelope.payload.tenant, message).toBe(t);
      expect(ctx.keyRegistry.get(e.envelope.payload.actor.key_id), message).toBeDefined();
    }
    // Imports came only from a pinned ledger.
    if (w.imported[t].size > 0) expect(w.pinned[t].size, message).toBeGreaterThan(0);
  }
  expect(ledgerIds.size, 'tenants must not share a ledger').toBe(TENANTS.length);
}

// ------------------------------------------------------------------------ runner

const ACTIONS: { weight: number; run: (w: World, r: Rand) => Promise<void> }[] = [
  { weight: 4, run: actRegister },
  { weight: 6, run: actSubmit },
  { weight: 4, run: actRead },
  { weight: 3, run: actAddPeer },
  { weight: 2, run: actImport },
];
const TOTAL = ACTIONS.reduce((n, a) => n + a.weight, 0);

describe('tenant isolation: stateful adversarial test against the real API', () => {
  const RUNS = 30;
  const STEPS = 22;
  for (let seed = 1; seed <= RUNS; seed++) {
    it(`seed ${seed}`, async () => {
      const rand = rng(seed * 7919);
      const w = await newWorld();
      try {
        for (let i = 0; i < STEPS; i++) {
          let x = rand() * TOTAL;
          const action = ACTIONS.find((a) => (x -= a.weight) < 0) ?? ACTIONS[0]!;
          await action.run(w, rand);
          await checkInvariants(w);
        }
      } finally {
        await w.server.close();
      }
    }, 60_000);
  }
});
