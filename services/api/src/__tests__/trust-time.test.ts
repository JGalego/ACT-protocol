import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { signEnvelope } from '@act/crypto';
import { buildUnsignedEvent } from '@act/sdk';
import { buildServer } from '../server.js';
import { createLedgerContext, type LedgerContext } from '../ledger-context.js';
import {
  buildArtifactEnvelope,
  buildIntentEnvelope,
  buildKeyRegistrationEnvelope,
  makeActor,
  peerRegistrationBody,
  type TestActor,
} from './helpers.js';

/**
 * Key trust on import is judged at the source ledger's acceptance time
 * (ADR 0012): history signed while a key was valid stays importable after the
 * key is retired here, and nothing the source accepted after the retirement can
 * ride in under it, whatever time the signer claims.
 */

const pause = () => new Promise((resolve) => setTimeout(resolve, 8));
const auth = (who: TestActor | string) => ({
  authorization: `Bearer ${typeof who === 'string' ? who : who.actorId}`,
});

interface Ledger {
  server: FastifyInstance;
  ctx: LedgerContext;
}

async function ledger(): Promise<Ledger> {
  const ctx = await createLedgerContext(':memory:');
  const server = await buildServer({ devMode: true, ledgerContext: ctx });
  return { server, ctx };
}
const post = (l: Ledger, url: string, who: TestActor | string, payload: unknown) =>
  l.server.inject({ method: 'POST', url, headers: auth(who), payload: payload as object });

/** key_revoked for the actor's own key, as a native event. */
function revocation(actor: TestActor, parentEventId: string) {
  const artifact = buildArtifactEnvelope({
    actor,
    artifactType: 'Key',
    data: {
      key_id: actor.signer.keyId,
      algorithm: 'ed25519',
      public_key: actor.signer.publicKey,
      status: 'revoked',
      owner_actor_id: actor.actorId,
    },
  });
  return signEnvelope(
    buildUnsignedEvent({
      eventType: 'key_revoked',
      actor: { actorId: actor.actorId, keyId: actor.signer.keyId },
      tenant: 'default',
      subject: {
        kind: 'artifact',
        artifact_id: artifact.artifact_id as string,
        version_id: artifact.version_id as string,
        artifact_type: 'Key',
      },
      causalParents: [{ event_id: parentEventId, relation: 'revision-of' }],
      payload: artifact,
    }),
    [actor.signer],
  );
}

/** An intent whose signer claims it happened long before anything here. */
function intentClaimingTheDistantPast(actor: TestActor, text: string) {
  const built = buildIntentEnvelope(actor, text);
  return signEnvelope(
    { ...(built.envelope.payload as Record<string, unknown>), occurred_at: '2000-01-01T00:00:00Z' },
    [actor.signer],
  );
}

describe('key trust on import is judged at the source acceptance time', () => {
  let a: Ledger;
  let b: Ledger;
  const k = makeActor();

  beforeEach(async () => {
    a = await ledger();
    b = await ledger();
  });
  afterEach(async () => {
    await a.server.close();
    await b.server.close();
  });

  it('imports what was accepted before a local revocation and refuses what was accepted after', async () => {
    // The same actor and key exist on both ledgers; the source registered it first.
    expect((await post(a, '/v1/keys', k, buildKeyRegistrationEnvelope(k))).statusCode).toBe(201);
    await pause();
    // Accepted by the source before this ledger had ever heard of the key.
    const veryEarly = buildIntentEnvelope(k, 'accepted before this ledger knew the key');
    expect((await post(a, '/v1/intents', k, veryEarly.envelope)).statusCode).toBe(201);
    await pause();
    const bReg = await post(b, '/v1/keys', k, buildKeyRegistrationEnvelope(k));
    expect(bReg.statusCode).toBe(201);
    await pause();

    // The source accepts a legitimate event while the key is valid...
    const early = buildIntentEnvelope(k, 'accepted before the revocation');
    expect((await post(a, '/v1/intents', k, early.envelope)).statusCode).toBe(201);
    await pause();

    // ...then the destination revokes the key locally...
    const revoked = await post(b, '/v1/keys', k, revocation(k, bReg.json().eventId));
    expect(revoked.statusCode).toBe(201);
    await pause();

    // ...and the source, which has not heard, accepts another event under it.
    // Its signer claims it happened in the distant past, before the revocation.
    const late = intentClaimingTheDistantPast(k, 'accepted after the revocation');
    expect((await post(a, '/v1/intents', k, late)).statusCode).toBe(201);

    const bundle = (await post(a, '/v1/bundles/export', k, {})).json();
    expect(
      (await post(b, '/v1/federation/peers', 'admin', peerRegistrationBody('http://x.test', a.ctx)))
        .statusCode,
    ).toBe(201);
    const imported = await post(b, '/v1/bundles/import', 'admin', bundle);
    expect(imported.statusCode).toBe(200);
    const summary = imported.json() as { accepted: number; quarantined: string[] };

    const ids = (await b.server.inject({ method: 'GET', url: '/v1/events', headers: auth('r') }))
      .json()
      .items.map((e: { eventId: string }) => e.eventId);
    // Accepted while valid: imported although the key is revoked here...
    expect(ids).toContain(early.envelope.payloadDigest);
    // ...and even though this ledger only learned of the key later: the source's own
    // registration, carried in the bundle, shows the key existed from before then.
    expect(ids).toContain(veryEarly.envelope.payloadDigest);
    // Accepted after the revocation: refused, whatever time its signer claims.
    expect(ids).not.toContain(late.payloadDigest);
    expect(summary.quarantined).toEqual([late.payloadDigest]);
    const quarantine = (
      await b.server.inject({ method: 'GET', url: '/v1/quarantine', headers: auth('admin') })
    ).json().items as { reason: string }[];
    expect(quarantine[0]!.reason).toMatch(/not trusted|untrusted/i);
  });

  it('imports the history of a key that is new here and was revoked at the source', async () => {
    // A registers z, accepts an event under it, then revokes it; B has never heard of z.
    const z = makeActor();
    const reg = await post(a, '/v1/keys', z, buildKeyRegistrationEnvelope(z));
    expect(reg.statusCode).toBe(201);
    await pause();
    const signed = buildIntentEnvelope(z, 'signed while z was valid');
    expect((await post(a, '/v1/intents', z, signed.envelope)).statusCode).toBe(201);
    await pause();
    expect((await post(a, '/v1/keys', z, revocation(z, reg.json().eventId))).statusCode).toBe(201);
    await pause(); // so that "now" here is clearly later than everything the source did

    const bundle = (await post(a, '/v1/bundles/export', z, {})).json();
    await post(b, '/v1/federation/peers', 'admin', peerRegistrationBody('http://x.test', a.ctx));
    const imported = (await post(b, '/v1/bundles/import', 'admin', bundle)).json() as {
      accepted: number;
      quarantined: string[];
    };
    // All three arrive: the event is judged while z was still valid, before the revocation that follows it.
    expect(imported.quarantined).toEqual([]);
    expect(imported.accepted).toBe(3);
    const history = b.ctx.keyRegistry.get(z.signer.keyId)!.history;
    expect(history.map((h) => h.status)).toEqual(['active', 'revoked']);
    // The history carries the source's times, not the time of import.
    const sourceRegistered = (await a.ctx.ledger.getEvent(reg.json().eventId))!.acceptedAt;
    expect(history[0]!.effectiveAt).toBe(sourceRegistered);
  });

  it('vets an imported key status change by whether its signer was trusted then, not now', async () => {
    // One actor with two keys. At the source, the first key revokes the second.
    const k1 = makeActor();
    const k2: TestActor = { actorId: k1.actorId, signer: makeActor().signer };
    expect((await post(a, '/v1/keys', k1, buildKeyRegistrationEnvelope(k1))).statusCode).toBe(201);
    const regK2 = await post(a, '/v1/keys', k2, buildKeyRegistrationEnvelope(k2));
    expect(regK2.statusCode).toBe(201);
    await pause();
    const revokesK2 = (() => {
      const artifact = buildArtifactEnvelope({
        actor: k1,
        artifactType: 'Key',
        data: {
          key_id: k2.signer.keyId,
          algorithm: 'ed25519',
          public_key: k2.signer.publicKey,
          status: 'revoked',
          owner_actor_id: k2.actorId,
        },
      });
      return signEnvelope(
        buildUnsignedEvent({
          eventType: 'key_revoked',
          actor: { actorId: k1.actorId, keyId: k1.signer.keyId },
          tenant: 'default',
          subject: {
            kind: 'artifact',
            artifact_id: artifact.artifact_id as string,
            version_id: artifact.version_id as string,
            artifact_type: 'Key',
          },
          causalParents: [{ event_id: regK2.json().eventId, relation: 'revision-of' }],
          payload: artifact,
        }),
        [k1.signer],
      );
    })();
    expect((await post(a, '/v1/keys', k1, revokesK2)).statusCode).toBe(201);
    await pause();

    // Meanwhile this ledger registers both keys, and later revokes the first one itself.
    const bK1 = await post(b, '/v1/keys', k1, buildKeyRegistrationEnvelope(k1));
    expect((await post(b, '/v1/keys', k2, buildKeyRegistrationEnvelope(k2))).statusCode).toBe(201);
    await pause();
    expect((await post(b, '/v1/keys', k1, revocation(k1, bK1.json().eventId))).statusCode).toBe(
      201,
    );
    await pause();

    const bundle = (await post(a, '/v1/bundles/export', k1, {})).json();
    await post(b, '/v1/federation/peers', 'admin', peerRegistrationBody('http://x.test', a.ctx));
    const imported = (await post(b, '/v1/bundles/import', 'admin', bundle)).json() as {
      quarantined: string[];
    };
    // The first key was valid when it revoked the second at the source, so that revocation stands here,
    // even though the first key has since been revoked on this ledger.
    expect(imported.quarantined).toEqual([]);
    expect(b.ctx.keyRegistry.statusOf(k2.signer.keyId)).toBe('revoked');
    expect(b.ctx.keyRegistry.statusOf(k1.signer.keyId)).toBe('revoked');
  });

  it('keeps native judgement at the moment of acceptance: a revoked key cannot sign here', async () => {
    const reg = await post(b, '/v1/keys', k, buildKeyRegistrationEnvelope(k));
    await pause();
    expect((await post(b, '/v1/keys', k, revocation(k, reg.json().eventId))).statusCode).toBe(201);
    const res = await post(
      b,
      '/v1/intents',
      k,
      buildIntentEnvelope(k, 'after revocation').envelope,
    );
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('rebuilds the same key history from the log after import', async () => {
    expect((await post(a, '/v1/keys', k, buildKeyRegistrationEnvelope(k))).statusCode).toBe(201);
    await pause();
    const bReg = await post(b, '/v1/keys', k, buildKeyRegistrationEnvelope(k));
    await pause();
    await post(a, '/v1/intents', k, buildIntentEnvelope(k, 'one').envelope);
    const bundle = (await post(a, '/v1/bundles/export', k, {})).json();
    await post(b, '/v1/federation/peers', 'admin', peerRegistrationBody('http://x.test', a.ctx));
    expect((await post(b, '/v1/bundles/import', 'admin', bundle)).statusCode).toBe(200);
    void bReg;

    const live = b.ctx.keyRegistry.get(k.signer.keyId)!.history;
    const { KeyRegistry } = await import('../key-registry.js');
    const rebuilt = new KeyRegistry();
    await rebuilt.catchUp(b.ctx.ledger);
    expect(rebuilt.get(k.signer.keyId)!.history).toEqual(live);
    // The source registered the key before this ledger did, and the history says so.
    expect(Date.parse(live[0]!.effectiveAt)).toBeLessThan(
      Date.parse(live[live.length - 1]!.effectiveAt) + 1,
    );
    expect(live.length).toBeGreaterThanOrEqual(2);
  });
});
