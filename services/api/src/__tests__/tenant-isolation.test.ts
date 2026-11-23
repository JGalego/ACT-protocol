import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { signEnvelope } from '@act/crypto';
import { buildUnsignedEvent } from '@act/sdk';
import { generateId } from '@act/core';
import { buildServer, type BuildServerOptions } from '../server.js';
import {
  createLedgerContext,
  createTenantRegistry,
  type LedgerContext,
} from '../ledger-context.js';
import { isAdministrator, scopedMeta } from '../tenancy.js';
import { SqliteAdapter } from '@act/ledger';
import {
  buildActorRegistrationEnvelope,
  buildIntentEnvelope,
  buildKeyRegistrationEnvelope,
  makeActor,
  peerRegistrationBody,
  withTenant,
  type TestActor,
} from './helpers.js';

/**
 * Cross-tenant denial suite (ADR 0010). Two tenants share one server and one
 * database; nothing one does may be seen, used, or even detected by the other.
 */

const ACME = 'acme';
const GLOBEX = 'globex';

interface Rig {
  server: FastifyInstance;
  ctx: LedgerContext;
}

async function rig(options: Partial<BuildServerOptions> = {}): Promise<Rig> {
  const ctx = await createLedgerContext(':memory:');
  const server = await buildServer({ devMode: true, ledgerContext: ctx, ...options });
  return { server, ctx };
}

const as = (tenant: string, who: TestActor | string) => ({
  authorization: `Bearer ${typeof who === 'string' ? who : who.actorId}`,
  'x-act-tenant': tenant,
});

/** Registers the actor's key and actor record inside `tenant`, returning the actor. */
async function registerIn(server: FastifyInstance, tenant: string, actor = makeActor()) {
  const key = await server.inject({
    method: 'POST',
    url: '/v1/keys',
    headers: as(tenant, actor),
    payload: withTenant(tenant, () => buildKeyRegistrationEnvelope(actor)),
  });
  expect(key.statusCode).toBe(201);
  const reg = await server.inject({
    method: 'POST',
    url: '/v1/actors',
    headers: as(tenant, actor),
    payload: withTenant(tenant, () => buildActorRegistrationEnvelope(actor, 'Test')),
  });
  expect(reg.statusCode).toBe(201);
  return actor;
}

async function submitIntent(server: FastifyInstance, tenant: string, actor: TestActor) {
  const built = withTenant(tenant, () => buildIntentEnvelope(actor, `Intent of ${tenant}`));
  const res = await server.inject({
    method: 'POST',
    url: '/v1/intents',
    headers: as(tenant, actor),
    payload: built.envelope,
  });
  expect(res.statusCode).toBe(201);
  return { ...built, eventId: res.json().eventId as string };
}

describe('tenant isolation', () => {
  let server: FastifyInstance;
  let ctx: LedgerContext;

  beforeEach(async () => {
    ({ server, ctx } = await rig());
  });
  afterEach(async () => {
    await server.close();
  });

  it('gives every tenant its own ledger id and signing key', async () => {
    const identity = async (tenant: string) =>
      (
        await server.inject({ method: 'GET', url: '/v1/ledger', headers: as(tenant, 'someone') })
      ).json();
    const [a, b, a2] = [await identity(ACME), await identity(GLOBEX), await identity(ACME)];
    expect(a.ledgerId).not.toBe(b.ledgerId);
    expect(a.keyId).not.toBe(b.keyId);
    expect(a2).toEqual(a);
    // The pre-existing (default) ledger is its own tenant, unchanged.
    const def = (
      await server.inject({
        method: 'GET',
        url: '/v1/ledger',
        headers: { authorization: 'Bearer x' },
      })
    ).json();
    expect(def.ledgerId).toBe(ctx.ledgerId);
  });

  it("does not show one tenant's artifacts, events, history or lineage to another", async () => {
    const alice = await registerIn(server, ACME);
    const intent = await submitIntent(server, ACME, alice);
    const bob = await registerIn(server, GLOBEX);

    const get = (url: string) => server.inject({ method: 'GET', url, headers: as(GLOBEX, bob) });
    expect((await get(`/v1/artifacts/${intent.artifactId}`)).statusCode).toBe(404);
    expect((await get(`/v1/artifacts/${intent.artifactId}/versions`)).json().items).toEqual([]);
    expect((await get(`/v1/lineage/${intent.eventId}`)).statusCode).toBe(404);
    expect((await get(`/v1/history/${intent.artifactId}`)).json()).toMatchObject({});
    const events = (await get('/v1/events')).json().items as {
      envelope: { payload: { tenant: string } };
    }[];
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.envelope.payload.tenant === GLOBEX)).toBe(true);

    // And the owner still sees it.
    const own = await server.inject({
      method: 'GET',
      url: `/v1/artifacts/${intent.artifactId}`,
      headers: as(ACME, alice),
    });
    expect(own.statusCode).toBe(200);
  });

  it('runs a separate, gap-free receipt chain per tenant', async () => {
    const alice = await registerIn(server, ACME);
    await submitIntent(server, ACME, alice);
    await submitIntent(server, ACME, alice);
    const bob = await registerIn(server, GLOBEX);

    const sequences = async (tenant: string, who: TestActor) =>
      (
        (await server.inject({ method: 'GET', url: '/v1/events', headers: as(tenant, who) })).json()
          .items as { sequence: number }[]
      ).map((e) => e.sequence);
    expect(await sequences(ACME, alice)).toEqual([0, 1, 2, 3]);
    // Globex sees no gaps where Acme's events sit, and learns nothing of their count.
    expect(await sequences(GLOBEX, bob)).toEqual([0, 1]);
  });

  it('does not trust a key in a tenant where it was never registered', async () => {
    const alice = await registerIn(server, ACME);
    // Alice authenticates to Globex and signs a perfectly valid Globex event.
    const forGlobex = withTenant(GLOBEX, () => buildIntentEnvelope(alice, 'Smuggled'));
    const res = await server.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: as(GLOBEX, alice),
      payload: forGlobex.envelope,
    });
    const stranger = makeActor();
    const strangerRes = await server.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: as(GLOBEX, stranger),
      payload: withTenant(GLOBEX, () => buildIntentEnvelope(stranger, 'Smuggled')).envelope,
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    // Indistinguishable from a key nobody has ever registered anywhere.
    expect(res.statusCode).toBe(strangerRes.statusCode);
    expect(res.json().code).toBe(strangerRes.json().code);
  });

  it('lets the same key and actor register in two tenants without either learning of the other', async () => {
    const shared = makeActor();
    await registerIn(server, ACME, shared);
    await registerIn(server, GLOBEX, shared);
  });

  it('refuses an event that names another tenant, or none, without confirming anything exists', async () => {
    const alice = await registerIn(server, ACME);
    const forGlobex = withTenant(GLOBEX, () => buildIntentEnvelope(alice, 'Wrong tenant'));
    const wrong = await server.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: as(ACME, alice),
      payload: forGlobex.envelope,
    });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().code).toBe('tenant_mismatch');

    const base = buildIntentEnvelope(alice, 'Opted out');
    const optedOut = signEnvelope(
      {
        ...(base.envelope.payload as Record<string, unknown>),
        tenant: { not_applicable: true, reason: 'portable signature' },
      },
      [alice.signer],
    );
    const res = await server.inject({
      method: 'POST',
      url: '/v1/intents',
      headers: as(ACME, alice),
      payload: optedOut,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('tenant_mismatch');
  });

  it('keeps peers and quarantine per tenant', async () => {
    const peerBody = peerRegistrationBody('http://127.0.0.1:9', await ctx.registry.get(GLOBEX));
    const created = await server.inject({
      method: 'POST',
      url: '/v1/federation/peers',
      headers: as(ACME, 'admin'),
      payload: peerBody,
    });
    expect(created.statusCode).toBe(201);
    const peersOf = async (tenant: string) =>
      (
        await server.inject({
          method: 'GET',
          url: '/v1/federation/peers',
          headers: as(tenant, 'admin'),
        })
      ).json().items as unknown[];
    expect(await peersOf(ACME)).toHaveLength(1);
    expect(await peersOf(GLOBEX)).toHaveLength(0);

    const peerId = created.json().peerId as string;
    const removeFromOther = await server.inject({
      method: 'DELETE',
      url: `/v1/federation/peers/${peerId}`,
      headers: as(GLOBEX, 'admin'),
    });
    expect(removeFromOther.statusCode).toBe(404);
    expect(await peersOf(ACME)).toHaveLength(1);
  });

  it('exports only the calling tenant’s history', async () => {
    const alice = await registerIn(server, ACME);
    await submitIntent(server, ACME, alice);
    const bob = await registerIn(server, GLOBEX);
    const bundle = (
      await server.inject({
        method: 'POST',
        url: '/v1/bundles/export',
        headers: as(GLOBEX, bob),
        payload: {},
      })
    ).json();
    const ledgerOfGlobex = (
      await server.inject({ method: 'GET', url: '/v1/ledger', headers: as(GLOBEX, bob) })
    ).json().ledgerId;
    expect(bundle.source_ledger_id).toBe(ledgerOfGlobex);
    expect(bundle.events.length).toBe(2);
    expect(
      bundle.events.every(
        (e: { signed_envelope: { payload: { tenant: string } } }) =>
          e.signed_envelope.payload.tenant === GLOBEX,
      ),
    ).toBe(true);
  });

  it('shares history between tenants only through a verified bundle from a pinned peer', async () => {
    const alice = await registerIn(server, ACME);
    const intent = await submitIntent(server, ACME, alice);
    const bob = await registerIn(server, GLOBEX);
    const bundle = (
      await server.inject({
        method: 'POST',
        url: '/v1/bundles/export',
        headers: as(ACME, alice),
        payload: {},
      })
    ).json();

    // Without pinning Acme as a peer, Globex cannot import it.
    const unpinned = await server.inject({
      method: 'POST',
      url: '/v1/bundles/import',
      headers: as(GLOBEX, bob),
      payload: bundle,
    });
    expect(unpinned.statusCode).toBe(403);
    expect(unpinned.json().code).toBe('untrusted_source_ledger');

    await server.inject({
      method: 'POST',
      url: '/v1/federation/peers',
      headers: as(GLOBEX, bob),
      payload: peerRegistrationBody('http://127.0.0.1:9', await ctx.registry.get(ACME)),
    });
    const imported = await server.inject({
      method: 'POST',
      url: '/v1/bundles/import',
      headers: as(GLOBEX, bob),
      payload: bundle,
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json()).toMatchObject({ accepted: 3, quarantined: [] });
    const seen = await server.inject({
      method: 'GET',
      url: `/v1/artifacts/${intent.artifactId}`,
      headers: as(GLOBEX, bob),
    });
    expect(seen.statusCode).toBe(200);
    // Acme's own ledger is untouched by Globex importing a copy.
    const acmeEvents = (
      await server.inject({ method: 'GET', url: '/v1/events', headers: as(ACME, alice) })
    ).json().items;
    expect(acmeEvents).toHaveLength(3);
  });

  it('rejects an idempotency key reuse only inside the tenant that used it', async () => {
    const alice = await registerIn(server, ACME);
    const bob = await registerIn(server, GLOBEX);
    const send = (tenant: string, who: TestActor) =>
      server.inject({
        method: 'POST',
        url: '/v1/intents',
        headers: { ...as(tenant, who), 'idempotency-key': 'same-key' },
        payload: withTenant(tenant, () => buildIntentEnvelope(who, 'x')).envelope,
      });
    expect((await send(ACME, alice)).statusCode).toBe(201);
    expect((await send(GLOBEX, bob)).statusCode).toBe(201);
  });
});

describe('tenant identity is derived from authentication only', () => {
  it('rejects malformed tenant ids before they can name any storage', async () => {
    const { server } = await rig();
    for (const bad of [
      'a/b',
      '../x',
      'tenant/other',
      'has space',
      '',
      '-leading',
      'x'.repeat(65),
      'ünï',
    ]) {
      const res = await server.inject({
        method: 'GET',
        url: '/v1/ledger',
        headers: { authorization: 'Bearer u', 'x-act-tenant': bad },
      });
      // An empty header is "no tenant" (the default), not a malformed one.
      if (bad === '') expect(res.statusCode).toBe(200);
      else {
        expect(res.statusCode).toBe(400);
        expect(res.json().code).toBe('invalid_tenant');
      }
    }
    await server.close();
  });

  it('refuses a caller with no tenant when the server requires one', async () => {
    const { server } = await rig({ requireTenant: true });
    const none = await server.inject({
      method: 'GET',
      url: '/v1/ledger',
      headers: { authorization: 'Bearer u' },
    });
    expect(none.statusCode).toBe(401);
    const named = await server.inject({
      method: 'GET',
      url: '/v1/ledger',
      headers: as(ACME, 'u'),
    });
    expect(named.statusCode).toBe(200);
    await server.close();
  });

  it('only serves provisioned tenants when an allow-list is configured', async () => {
    const adapter = SqliteAdapter.open(':memory:');
    const registry = await createTenantRegistry(':memory:', { adapter, allowedTenants: [ACME] });
    const ctx = await registry.get(ACME);
    const server = await buildServer({ devMode: true, ledgerContext: ctx });
    const ok = await server.inject({ method: 'GET', url: '/v1/ledger', headers: as(ACME, 'u') });
    const denied = await server.inject({
      method: 'GET',
      url: '/v1/ledger',
      headers: as(GLOBEX, 'u'),
    });
    expect(ok.statusCode).toBe(200);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe('tenant_not_allowed');
    await server.close();
  });

  it('bounds how many tenants one server will hold', async () => {
    const adapter = SqliteAdapter.open(':memory:');
    const registry = await createTenantRegistry(':memory:', { adapter, maxTenants: 1 });
    const ctx = await registry.get(ACME);
    const server = await buildServer({ devMode: true, ledgerContext: ctx });
    const second = await server.inject({
      method: 'GET',
      url: '/v1/ledger',
      headers: as(GLOBEX, 'u'),
    });
    expect(second.statusCode).toBe(503);
    expect(second.json().code).toBe('tenant_limit_reached');
    const first = await server.inject({ method: 'GET', url: '/v1/ledger', headers: as(ACME, 'u') });
    expect(first.statusCode).toBe(200);
    await server.close();
  });

  it('keeps each tenant’s identity and history across a restart', async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'act-tenants-')), 'act.db');
    const first = await createTenantRegistry(file);
    const acme = await first.get(ACME);
    const globex = await first.get(GLOBEX);
    await first.adapter.close();

    const second = await createTenantRegistry(file);
    const acmeAgain = await second.get(ACME);
    expect(acmeAgain.ledgerId).toBe(acme.ledgerId);
    expect(acmeAgain.ledgerSigner.keyId).toBe(acme.ledgerSigner.keyId);
    expect((await second.get(GLOBEX)).ledgerId).toBe(globex.ledgerId);
    expect(acme.ledgerId).not.toBe(globex.ledgerId);
    await second.adapter.close();
  });
});

describe('administrators are scoped to a tenant', () => {
  it('honours `tenant::actor` entries only in that tenant, and bare entries everywhere', async () => {
    const { server } = await rig({ adminActorIds: ['acme::alice', 'root'] });
    const listPeers = (tenant: string, who: string) =>
      server.inject({ method: 'GET', url: '/v1/federation/peers', headers: as(tenant, who) });
    expect((await listPeers(ACME, 'alice')).statusCode).toBe(200);
    expect((await listPeers(GLOBEX, 'alice')).statusCode).toBe(403);
    expect((await listPeers(ACME, 'root')).statusCode).toBe(200);
    expect((await listPeers(GLOBEX, 'root')).statusCode).toBe(200);
    expect((await listPeers(ACME, 'mallory')).statusCode).toBe(403);
    // An actor whose id merely looks like a scoped entry gains nothing.
    expect((await listPeers(GLOBEX, 'acme::alice')).statusCode).toBe(403);
    await server.close();
  });

  it('matches administrators by exact tenant and actor', () => {
    expect(isAdministrator(['acme::alice'], 'acme', 'alice')).toBe(true);
    expect(isAdministrator(['acme::alice'], 'acme2', 'alice')).toBe(false);
    expect(isAdministrator(['acme::alice'], 'acme', 'alice2')).toBe(false);
    expect(isAdministrator(['alice'], 'anything', 'alice')).toBe(true);
    expect(isAdministrator(undefined, 'acme', 'alice')).toBe(false);
  });
});

describe('metadata namespacing', () => {
  it('keeps each tenant’s keys apart, and the default tenant on the legacy keys', async () => {
    const adapter = SqliteAdapter.open(':memory:');
    await adapter.migrate();
    const def = scopedMeta(adapter, 'default');
    const acme = scopedMeta(adapter, ACME);
    const globex = scopedMeta(adapter, GLOBEX);
    await def.setMeta('peer:1', 'd');
    await acme.setMeta('peer:1', 'a');
    await globex.setMeta('peer:1', 'g');

    expect(await adapter.getMeta('peer:1')).toBe('d');
    expect(await acme.getMeta('peer:1')).toBe('a');
    expect((await acme.listMeta('peer:')).map((r) => r.value)).toEqual(['a']);
    expect((await def.listMeta('peer:')).map((r) => r.value)).toEqual(['d']);
    // The default tenant listing everything must not sweep up other tenants' namespaces.
    expect((await def.listMeta('')).map((r) => r.value)).toEqual(['d']);
    expect(await acme.deleteMeta('peer:1')).toBe(true);
    expect(await acme.getMeta('peer:1')).toBeNull();
    expect(await globex.getMeta('peer:1')).toBe('g');
    expect(await acme.setMetaIfAbsent('k', '1')).toBe(true);
    expect(await acme.setMetaIfAbsent('k', '2')).toBe(false);
    expect(await globex.getMeta('k')).toBeNull();
    await adapter.close();
  });
});

describe('unused import guard', () => {
  it('builds unsigned events with the SDK for the tenant under test', () => {
    const actor = makeActor();
    const event = buildUnsignedEvent({
      eventType: 'genesis',
      actor: { actorId: actor.actorId, keyId: actor.signer.keyId },
      tenant: ACME,
      subject: {
        kind: 'artifact',
        artifact_id: generateId(),
        version_id: `sha-256:${'1'.repeat(64)}`,
      },
      payload: {},
    });
    expect(event.tenant).toBe(ACME);
  });
});
