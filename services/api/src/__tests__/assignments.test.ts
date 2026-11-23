import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { generateId } from '@act/core';
import { signEnvelope } from '@act/crypto';
import { buildUnsignedEvent } from '@act/sdk';
import { buildServer } from '../server.js';
import {
  createLedgerContext,
  createTenantRegistry,
  type LedgerContext,
} from '../ledger-context.js';
import { isActiveAt, type Assignment } from '../role-registry.js';
import {
  buildAssignmentEnvelope,
  buildIntentEnvelope,
  buildKeyRegistrationEnvelope,
  makeActor,
  peerRegistrationBody,
  withTenant,
  type TestActor,
} from './helpers.js';

/** Accountability assignments: who may grant, end and rely on a role (ADR 0011). */

const SCOPE = 'payments';
const hdr = (who: TestActor | string, tenant?: string) => ({
  authorization: `Bearer ${typeof who === 'string' ? who : who.actorId}`,
  ...(tenant ? { 'x-act-tenant': tenant } : {}),
});

describe('accountability assignments', () => {
  let server: FastifyInstance;
  let ctx: LedgerContext;
  let admin: TestActor;
  let anchor: string;

  const post = (url: string, who: TestActor, payload: unknown) =>
    server.inject({ method: 'POST', url, headers: hdr(who), payload: payload as object });
  const get = (url: string) => server.inject({ method: 'GET', url, headers: hdr('reader') });

  async function register(actor = makeActor()) {
    const key = await post('/v1/keys', actor, buildKeyRegistrationEnvelope(actor));
    expect(key.statusCode).toBe(201);
    return actor;
  }

  /** Records a grant (or, with `revises`, the next version) and returns the response. */
  async function record(
    issuer: TestActor,
    assignee: TestActor,
    role: string,
    options: Partial<Parameters<typeof buildAssignmentEnvelope>[0]> = {},
  ) {
    const built = buildAssignmentEnvelope({
      issuer,
      assignee,
      role,
      scope: SCOPE,
      parentEventId: anchor,
      ...options,
    });
    const res = await post('/v1/assignments', issuer, built.envelope);
    return { res, assignmentId: built.assignmentId, eventId: res.json().eventId as string };
  }

  beforeEach(async () => {
    ctx = await createLedgerContext(':memory:');
    admin = makeActor();
    server = await buildServer({
      devMode: true,
      ledgerContext: ctx,
      adminActorIds: [admin.actorId],
    });
    await register(admin);
    const events = (await get('/v1/events?limit=1')).json().items as { eventId: string }[];
    anchor = events[0]!.eventId;
  });
  afterEach(async () => {
    await server.close();
  });

  it('lets an administrator grant a role, and shows it as held', async () => {
    const bob = await register();
    const { res, assignmentId } = await record(admin, bob, 'approver');
    expect(res.statusCode).toBe(201);
    const listed = (await get(`/v1/assignments?actor=${bob.actorId}&active=true`)).json().items;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      assignmentId,
      role: 'approver',
      scope: SCOPE,
      activeNow: true,
    });
    expect(ctx.roleRegistry.rolesOf(bob.actorId, SCOPE, Date.now())).toEqual(['approver']);
    expect(ctx.roleRegistry.rolesOf(bob.actorId, 'elsewhere', Date.now())).toEqual([]);
  });

  it('refuses a grant from anyone who is neither an administrator nor an owner of the scope', async () => {
    const mallory = await register();
    const bob = await register();
    const { res } = await record(mallory, bob, 'approver');
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('assignment_not_authorized');
    expect((await get('/v1/assignments')).json().items).toHaveLength(0);
  });

  it('lets an owner delegate inside their scope, but not outside it and not to themselves', async () => {
    const owner = await register();
    const bob = await register();
    expect((await record(admin, owner, 'owner')).res.statusCode).toBe(201);

    expect((await record(owner, bob, 'approver')).res.statusCode).toBe(201);
    const elsewhere = await record(owner, bob, 'approver', { scope: 'other-project' });
    expect(elsewhere.res.statusCode).toBe(403);
    const toSelf = await record(owner, owner, 'approver');
    expect(toSelf.res.statusCode).toBe(403);
    expect(toSelf.res.json().code).toBe('assignment_not_authorized');
  });

  it('records an assignment only under its own issuer', async () => {
    const mallory = await register();
    const bob = await register();
    const forged = await record(mallory, bob, 'approver', { claimedIssuer: admin });
    expect(forged.res.statusCode).toBe(403);
    expect(forged.res.json().code).toBe('issuer_mismatch');
  });

  it('requires the assignee to be an actor with a registered key', async () => {
    const ghost = makeActor();
    const { res } = await record(admin, ghost, 'approver');
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('unknown_assignee');
  });

  it('versions an assignment: only status and end_time change, and ended or revoked is final', async () => {
    const bob = await register();
    const granted = await record(admin, bob, 'approver');
    const revise = (over: Partial<Parameters<typeof buildAssignmentEnvelope>[0]>, parent: string) =>
      record(admin, bob, 'approver', {
        assignmentId: granted.assignmentId,
        revises: true,
        parentEventId: parent,
        ...over,
      });

    // A role cannot be rewritten in place.
    const swapped = await record(admin, bob, 'owner', {
      assignmentId: granted.assignmentId,
      revises: true,
      parentEventId: granted.eventId,
    });
    expect(swapped.res.statusCode).toBe(409);
    expect(swapped.res.json().code).toBe('assignment_field_immutable');

    // A revision must build on the latest version.
    const stale = await revise({ status: 'revoked' }, anchor);
    expect(stale.res.statusCode).toBe(409);
    expect(stale.res.json().code).toBe('not_latest_version');

    const revoked = await revise({ status: 'revoked' }, granted.eventId);
    expect(revoked.res.statusCode).toBe(201);
    expect(ctx.roleRegistry.rolesOf(bob.actorId, SCOPE, Date.now())).toEqual([]);

    const revived = await revise({ status: 'active' }, revoked.eventId);
    expect(revived.res.statusCode).toBe(409);
    expect(revived.res.json().code).toBe('invalid_assignment_transition');
  });

  it('lets the issuer, an administrator, an owner of the scope, or the assignee end a role, each within their powers', async () => {
    const issuerOwner = await register();
    const owner = await register();
    const bob = await register();
    const eve = await register();
    expect((await record(admin, issuerOwner, 'owner')).res.statusCode).toBe(201);
    expect((await record(admin, owner, 'owner')).res.statusCode).toBe(201);

    /** A fresh grant by `issuerOwner`, so the original issuer is neither the admin nor the actor under test. */
    const grant = async () => {
      const g = await record(issuerOwner, bob, 'approver', { endTime: '2099-01-01T00:00:00Z' });
      expect(g.res.statusCode).toBe(201);
      return g;
    };
    /** Someone other than the issuer records the next version; the data keeps naming the original issuer. */
    const revise = (
      by: TestActor,
      g: Awaited<ReturnType<typeof grant>>,
      status: 'active' | 'ended' | 'revoked',
      endTime: string,
    ) =>
      record(by, bob, 'approver', {
        assignmentId: g.assignmentId,
        revises: true,
        parentEventId: g.eventId,
        status,
        endTime,
        claimedIssuer: issuerOwner,
      });

    // A stranger can do nothing to it.
    const g1 = await grant();
    const stranger = await revise(eve, g1, 'revoked', '2099-01-01T00:00:00Z');
    expect(stranger.res.statusCode).toBe(403);
    expect(stranger.res.json().code).toBe('assignment_not_authorized');

    // The assignee may end their own role, but not revoke it or move its end.
    const resignedRevoke = await revise(bob, g1, 'revoked', '2099-01-01T00:00:00Z');
    expect(resignedRevoke.res.statusCode).toBe(403);
    const extended = await revise(bob, g1, 'active', '2100-01-01T00:00:00Z');
    expect(extended.res.statusCode).toBe(403);
    const resigned = await revise(bob, g1, 'ended', '2099-01-01T00:00:00Z');
    expect(resigned.res.statusCode).toBe(201);
    expect(ctx.roleRegistry.rolesOf(bob.actorId, SCOPE, Date.now())).toEqual([]);

    // An administrator, another owner of the scope, and the issuer may each revoke.
    for (const by of [admin, owner, issuerOwner]) {
      const g = await grant();
      expect(ctx.roleRegistry.rolesOf(bob.actorId, SCOPE, Date.now())).toEqual(['approver']);
      const ended = await revise(by, g, 'revoked', '2099-01-01T00:00:00Z');
      expect(ended.res.statusCode).toBe(201);
      expect(ctx.roleRegistry.rolesOf(bob.actorId, SCOPE, Date.now())).toEqual([]);
    }
  });

  it('counts a role only inside its time window, as the ledger saw it', async () => {
    const bob = await register();
    const future = await record(admin, bob, 'approver', {
      startTime: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(future.res.statusCode).toBe(201);
    expect(ctx.roleRegistry.rolesOf(bob.actorId, SCOPE, Date.now())).toEqual([]);
    expect(ctx.roleRegistry.rolesOf(bob.actorId, SCOPE, Date.now() + 7_200_000)).toEqual([
      'approver',
    ]);

    const lapsed = await record(admin, bob, 'reviewer', {
      startTime: new Date(Date.now() - 7_200_000).toISOString(),
      endTime: new Date(Date.now() - 3_600_000).toISOString(),
    });
    expect(lapsed.res.statusCode).toBe(201);
    expect(ctx.roleRegistry.rolesOf(bob.actorId, SCOPE, Date.now())).toEqual([]);
  });

  it('cannot be backdated to authorize an earlier decision', async () => {
    const bob = await register();
    const before = Date.now() - 1000;
    await record(admin, bob, 'approver', { startTime: '2000-01-01T00:00:00Z' });
    // The claimed start is years ago, but the ledger accepted the grant just now.
    expect(ctx.roleRegistry.rolesOf(bob.actorId, SCOPE, before)).toEqual([]);
    expect(ctx.roleRegistry.rolesOf(bob.actorId, SCOPE, Date.now() + 1000)).toEqual(['approver']);
  });

  it('is what authorizes selecting an effective intent: before, after, and after revocation', async () => {
    const proposer = await register();
    const bob = await register();
    ctx.policy.authority = {
      policy: {
        policy_id: generateId(),
        policy_version: `sha-256:${'7'.repeat(64)}`,
        scope: { project: SCOPE },
        authorized_roles: ['approver'],
        quorum: 1,
      },
    };
    const root = buildIntentEnvelope(proposer, 'baseline');
    expect((await post('/v1/intents', proposer, root.envelope)).statusCode).toBe(201);
    let selections = 0;
    const select = () =>
      signEnvelope(
        buildUnsignedEvent({
          eventType: 'intent_effective_selected',
          actor: { actorId: bob.actorId, keyId: bob.signer.keyId },
          tenant: 'default',
          subject: {
            kind: 'artifact',
            artifact_id: root.artifactId,
            version_id: root.versionId,
            artifact_type: 'Intent',
          },
          causalParents: [{ event_id: root.envelope.payloadDigest, relation: 'approval-of' }],
          // A distinct claimed time makes each attempt a new event rather than a replay of the last.
          occurredAt: new Date(Date.UTC(2026, 0, 1, 0, 0, ++selections)).toISOString(),
          payload: (root.envelope.payload as { payload: Record<string, unknown> }).payload,
        }),
        [bob.signer],
      );
    // The policy scope is data.scope of the selected intent; the fixture's scope must match.
    const scopeOfIntent = (root.envelope.payload as { payload: { data: { scope?: string } } })
      .payload.data.scope;
    ctx.policy.authority.policy.scope.project = String(scopeOfIntent ?? '');
    const projectScope = String(scopeOfIntent ?? '');

    expect((await post('/v1/intents', bob, select())).statusCode).toBe(403);

    const granted = await record(admin, bob, 'approver', { scope: projectScope });
    expect(granted.res.statusCode).toBe(201);
    expect((await post('/v1/intents', bob, select())).statusCode).toBe(201);

    // Revoked roles do not authorize the next selection.
    const revoked = await record(admin, bob, 'approver', {
      scope: projectScope,
      assignmentId: granted.assignmentId,
      revises: true,
      parentEventId: granted.eventId,
      status: 'revoked',
    });
    expect(revoked.res.statusCode).toBe(201);
    const again = await post('/v1/intents', bob, select());
    expect(again.statusCode).toBe(403);
  });

  it('rebuilds the same roles from the log after a restart', async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'act-roles-')), 'act.db');
    const first = await createTenantRegistry(file);
    const c1 = await first.get('default');
    const srv = await buildServer({
      devMode: true,
      ledgerContext: c1,
      adminActorIds: [admin.actorId],
    });
    const bob = makeActor();
    const a = admin;
    const send = (url: string, who: TestActor, payload: unknown) =>
      srv.inject({ method: 'POST', url, headers: hdr(who), payload: payload as object });
    expect((await send('/v1/keys', a, buildKeyRegistrationEnvelope(a))).statusCode).toBe(201);
    const keyRes = await send('/v1/keys', bob, buildKeyRegistrationEnvelope(bob));
    const granted = buildAssignmentEnvelope({
      issuer: a,
      assignee: bob,
      role: 'approver',
      scope: SCOPE,
      parentEventId: keyRes.json().eventId,
    });
    expect((await send('/v1/assignments', a, granted.envelope)).statusCode).toBe(201);
    const before = c1.roleRegistry.list();
    await srv.close();
    await first.adapter.close();

    const second = await createTenantRegistry(file);
    const c2 = await second.get('default');
    expect(c2.roleRegistry.list()).toEqual(before);
    expect(c2.roleRegistry.rolesOf(bob.actorId, SCOPE, Date.now())).toEqual(['approver']);
    await second.adapter.close();
  });

  it('keeps one tenant’s assignments out of another’s', async () => {
    const t = async (tenant: string, who: TestActor, url: string, payload: unknown) =>
      server.inject({ method: 'POST', url, headers: hdr(who, tenant), payload: payload as object });
    const adminB = admin;
    const bob = makeActor();
    ctx.policy.adminActorIds = [adminB.actorId];
    const keyAdmin = await t(
      'acme',
      adminB,
      '/v1/keys',
      withTenant('acme', () => buildKeyRegistrationEnvelope(adminB)),
    );
    const keyBob = await t(
      'acme',
      bob,
      '/v1/keys',
      withTenant('acme', () => buildKeyRegistrationEnvelope(bob)),
    );
    expect(keyAdmin.statusCode).toBe(201);
    const granted = withTenant('acme', () =>
      buildAssignmentEnvelope({
        issuer: adminB,
        assignee: bob,
        role: 'approver',
        scope: SCOPE,
        parentEventId: keyBob.json().eventId,
      }),
    );
    expect((await t('acme', adminB, '/v1/assignments', granted.envelope)).statusCode).toBe(201);
    const list = async (tenant: string) =>
      (
        await server.inject({
          method: 'GET',
          url: '/v1/assignments',
          headers: hdr('reader', tenant),
        })
      ).json().items;
    expect(await list('acme')).toHaveLength(1);
    expect(await list('globex')).toHaveLength(0);
    const detail = await server.inject({
      method: 'GET',
      url: `/v1/assignments/${granted.assignmentId}`,
      headers: hdr('reader', 'globex'),
    });
    expect(detail.statusCode).toBe(404);
  });

  it('gives a federation import no authority: a peer’s assignments are recorded but confer no role', async () => {
    const other = await createLedgerContext(':memory:');
    const peer = await buildServer({
      devMode: true,
      ledgerContext: other,
      adminActorIds: [admin.actorId],
    });
    const send = (url: string, who: TestActor, payload: unknown) =>
      peer.inject({ method: 'POST', url, headers: hdr(who), payload: payload as object });
    const bob = makeActor();
    await send('/v1/keys', admin, buildKeyRegistrationEnvelope(admin));
    const bobKey = await send('/v1/keys', bob, buildKeyRegistrationEnvelope(bob));
    const granted = buildAssignmentEnvelope({
      issuer: admin,
      assignee: bob,
      role: 'approver',
      scope: SCOPE,
      parentEventId: bobKey.json().eventId,
    });
    expect((await send('/v1/assignments', admin, granted.envelope)).statusCode).toBe(201);
    const bundle = (
      await peer.inject({
        method: 'POST',
        url: '/v1/bundles/export',
        headers: hdr(admin),
        payload: {},
      })
    ).json();
    await peer.close();

    const pin = await post(
      '/v1/federation/peers',
      admin,
      peerRegistrationBody('http://127.0.0.1:9', other),
    );
    expect(pin.statusCode).toBe(201);
    const imported = await post('/v1/bundles/import', admin, bundle);
    expect(imported.statusCode).toBe(200);
    // The events arrived (the assignment is in the log)...
    expect((await get(`/v1/artifacts/${granted.assignmentId}/versions`)).json().items).toHaveLength(
      1,
    );
    // ...but they grant nothing here.
    expect((await get('/v1/assignments')).json().items).toHaveLength(0);
    expect(ctx.roleRegistry.rolesOf(bob.actorId, SCOPE, Date.now())).toEqual([]);
  });
});

describe('startup refuses operator-asserted roles', () => {
  it('rejects an authority file that still contains actorRoles, naming the replacement', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'act-authority-'));
    const file = path.join(dir, 'authority.json');
    writeFileSync(
      file,
      JSON.stringify({
        policy: {
          policy_id: 'p',
          policy_version: `sha-256:${'1'.repeat(64)}`,
          scope: { project: SCOPE },
          authorized_roles: ['owner'],
          quorum: 1,
        },
        actorRoles: { someone: ['owner'] },
      }),
    );
    const previous = process.env.ACT_AUTHORITY_POLICY_FILE;
    process.env.ACT_AUTHORITY_POLICY_FILE = file;
    try {
      await expect(
        buildServer({ devMode: true, ledgerContext: await createLedgerContext(':memory:') }),
      ).rejects.toThrow(/actorRoles.*accountability assignments/s);
    } finally {
      if (previous === undefined) delete process.env.ACT_AUTHORITY_POLICY_FILE;
      else process.env.ACT_AUTHORITY_POLICY_FILE = previous;
    }
  });
});

describe('isActiveAt', () => {
  const at = (iso: string) => Date.parse(iso);
  const assignment = (
    versions: Assignment['versions'],
    startTime = '2026-01-01T00:00:00Z',
  ): Assignment => ({
    assignmentId: 'a',
    role: 'approver',
    assigneeId: 'bob',
    scope: SCOPE,
    issuerId: 'admin',
    startTime,
    versions,
  });
  const v = (
    acceptedAt: string,
    status: 'active' | 'ended' | 'revoked',
    endTime: string | null = null,
  ) => ({
    eventId: acceptedAt,
    status,
    endTime,
    acceptedAt,
    recordedBy: 'admin',
  });

  it('answers as of any moment, using ledger acceptance times', () => {
    const a = assignment([
      v('2026-02-01T00:00:00Z', 'active'),
      v('2026-03-01T00:00:00Z', 'revoked'),
    ]);
    expect(isActiveAt(a, at('2026-01-15T00:00:00Z'))).toBe(false); // before it was granted
    expect(isActiveAt(a, at('2026-02-15T00:00:00Z'))).toBe(true);
    expect(isActiveAt(a, at('2026-03-15T00:00:00Z'))).toBe(false); // after revocation
  });

  it('honours the stated start and any end time', () => {
    const a = assignment(
      [v('2026-02-01T00:00:00Z', 'active', '2026-04-01T00:00:00Z')],
      '2026-02-10T00:00:00Z',
    );
    expect(isActiveAt(a, at('2026-02-05T00:00:00Z'))).toBe(false); // granted, not yet started
    expect(isActiveAt(a, at('2026-03-01T00:00:00Z'))).toBe(true);
    expect(isActiveAt(a, at('2026-04-01T00:00:00Z'))).toBe(false); // end is exclusive
  });
});
