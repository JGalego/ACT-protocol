import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { generateId } from '@act/core';
import { signEnvelope, type SignedEnvelope } from '@act/crypto';
import { verifyReceipt } from '@act/ledger';
import { buildUnsignedEvent } from '@act/sdk';
import { buildServer } from '../server.js';
import { createLedgerContext, type LedgerContext } from '../ledger-context.js';
import {
  buildActorRegistrationEnvelope,
  buildApprovalDecisionEnvelope,
  buildApprovalRequestEnvelope,
  buildArtifactEnvelope,
  buildKeyRegistrationEnvelope,
  makeActor,
  type TestActor,
} from './helpers.js';

/**
 * Model-based adversarial testing of the REAL API.
 *
 * formal/modules/WritePath.tla, ApprovalAuthorization.tla and LedgerAppend.tla
 * prove invariants about a model of the write path. This test closes the gap
 * between model and code: it plays the model's adversary against the actual
 * `services/api` handlers, and
 *
 *   1. for every action compares the API's accept/reject with a reference
 *      predicate transcribed from the TLA+ guards (`predictAccept*`), so a
 *      divergence between code and model fails here, and
 *   2. after every step re-checks the model's invariants against the ledger's
 *      own contents (`checkInvariants`): no event attributed to an actor whose
 *      key did not sign it, no event under a revoked key, a gap-free
 *      hash-chained receipt log, one decision per reviewer per request, no
 *      artifact lineage taken over by another actor.
 *
 * Sequences are generated from a seeded PRNG, so a failure reproduces exactly.
 *
 * The adversary controls `mallory` and `eve`; `alice` and `bob` are honest and
 * only ever sign events about themselves. No principal can sign with another's key.
 */

type Name = 'alice' | 'bob' | 'mallory' | 'eve';
const PRINCIPALS: Name[] = ['alice', 'bob', 'mallory', 'eve'];
const ADVERSARY: Name[] = ['mallory', 'eve'];

interface World {
  server: FastifyInstance;
  ctx: LedgerContext;
  who: Record<Name, TestActor>;
  registered: Set<Name>;
  revoked: Set<Name>;
  /** Intent artifacts successfully created: artifact id -> creator. */
  artifacts: Map<string, Name>;
  /** Approval requests that exist: request id -> {requester, subject, event id}. */
  requests: Map<
    string,
    { requester: Name; artifactId: string; versionId: string; eventId: string; anchor: string }
  >;
  decided: Set<string>; // `${requestId}|${reviewer}`
  /** Event ids the harness built using each principal's key as the (only) author. */
  authoredBy: Map<string, Name>;
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

const headers = (n: Name) => ({ authorization: `Bearer ${n}` });
async function post(w: World, url: string, by: Name, payload: unknown) {
  return w.server.inject({ method: 'POST', url, headers: headers(by), payload: payload as object });
}
const usable = (w: World, n: Name) => w.registered.has(n) && !w.revoked.has(n);

async function newWorld(): Promise<World> {
  const ctx = await createLedgerContext(':memory:');
  const server = await buildServer({ devMode: true, ledgerContext: ctx });
  const who = Object.fromEntries(PRINCIPALS.map((n) => [n, makeActor()])) as Record<
    Name,
    TestActor
  >;
  return {
    server,
    ctx,
    who,
    registered: new Set(),
    revoked: new Set(),
    artifacts: new Map(),
    requests: new Map(),
    decided: new Set(),
    authoredBy: new Map(),
    steps: [],
  };
}

// --------------------------------------------------------------------- actions

async function actRegister(w: World, rand: Rand) {
  const n = pick(rand, PRINCIPALS);
  const res = await post(w, '/v1/keys', n, buildKeyRegistrationEnvelope(w.who[n]));
  w.steps.push(`register(${n}) -> ${res.statusCode}`);
  if (w.revoked.has(n)) {
    // WritePath.tla: re-registering a revoked key must not bring it back (NoResurrection).
    // The code is stricter than the model: the registration is signed by the revoked
    // key, so it is refused outright.
    expect(res.statusCode, w.steps.join('\n')).toBe(403);
    const intent = await attemptIntent(w, { builder: n, claimActor: n, claimKey: n, signers: [n] });
    expect(intent.accepted, `revoked key resurrected\n${w.steps.join('\n')}`).toBe(false);
    return;
  }
  // Self-registration by the owner is always accepted (idempotent if already known).
  expect(res.statusCode, w.steps.join('\n')).toBe(201);
  w.registered.add(n);
  const actorReg = await post(w, '/v1/actors', n, buildActorRegistrationEnvelope(w.who[n], n));
  expect([201, 400, 403, 409]).toContain(actorReg.statusCode);
}

/** An attacker tries to bind a victim's key id to the attacker's own public key (WritePath: KeyBindingStable). */
async function actKeyTakeover(w: World, rand: Rand) {
  const attacker = pick(rand, ADVERSARY);
  const victim = pick(
    rand,
    PRINCIPALS.filter((p) => p !== attacker),
  );
  const forged: TestActor = {
    actorId: w.who[attacker].actorId,
    signer: { ...w.who[attacker].signer, keyId: w.who[victim].signer.keyId },
  };
  const res = await post(w, '/v1/keys', attacker, buildKeyRegistrationEnvelope(forged));
  w.steps.push(`keyTakeover(${attacker} -> ${victim}'s key id) -> ${res.statusCode}`);
  expect(res.statusCode, w.steps.join('\n')).toBe(400);
}

interface IntentSpec {
  builder: Name;
  claimActor: Name;
  claimKey: Name;
  signers: Name[];
  artifactId?: string;
}

/** Builds an Intent genesis event the way `builder` can: they hold only their own private key. */
function buildIntent(w: World, spec: IntentSpec): { envelope: SignedEnvelope; artifactId: string } {
  const claimed: TestActor = {
    actorId: w.who[spec.claimActor].actorId,
    signer: w.who[spec.claimKey].signer,
  };
  // The artifact is authored under the claimed identity but can only be signed with the builder's key.
  const artifact = buildArtifactEnvelope({
    actor: {
      actorId: claimed.actorId,
      signer: {
        ...claimed.signer,
        privateKey: w.who[spec.builder].signer.privateKey,
        publicKey: w.who[spec.builder].signer.publicKey,
      },
    },
    artifactType: 'Intent',
    ...(spec.artifactId ? { artifactId: spec.artifactId } : {}),
    data: { statement: `intent ${generateId()}`, scope: 'model' },
  });
  const event = buildUnsignedEvent({
    eventType: 'genesis',
    actor: { actorId: claimed.actorId, keyId: claimed.signer.keyId },
    tenant: 'default',
    subject: {
      kind: 'artifact',
      artifact_id: artifact.artifact_id as string,
      version_id: artifact.version_id as string,
      artifact_type: 'Intent',
    },
    payload: artifact,
  });
  // Every named signer signs under their own key id (a signer cannot sign as someone else).
  const envelope = signEnvelope(
    event,
    spec.signers.map((n) => w.who[n].signer),
  );
  return { envelope, artifactId: artifact.artifact_id as string };
}

/** The reference predicate, transcribed from WritePath.tla's `Accept` guard (all guards on). */
function predictAcceptIntent(w: World, spec: IntentSpec): boolean {
  const { builder, claimActor, claimKey, signers } = spec;
  return (
    signers.length > 0 &&
    // Everything is built by `builder`, so the claimed identity must be the builder's own
    // (otherwise the artifact's authoring signature, or an actor/key binding, fails).
    claimActor === builder &&
    claimKey === builder &&
    signers.includes(claimKey) &&
    signers.every((s) => usable(w, s)) &&
    usable(w, claimKey)
  );
}

async function attemptIntent(w: World, spec: IntentSpec) {
  const { envelope, artifactId } = buildIntent(w, spec);
  const res = await post(w, '/v1/intents', spec.builder, envelope);
  return {
    accepted: res.statusCode === 201,
    status: res.statusCode,
    envelope,
    artifactId,
    body: res.body,
  };
}

async function actIntent(w: World, rand: Rand) {
  const builder = pick(rand, PRINCIPALS);
  const honest = !ADVERSARY.includes(builder);
  // Honest principals only sign events about themselves with their own key; the adversary tries every combination.
  const claimActor = honest ? builder : pick(rand, PRINCIPALS);
  const claimKey = honest ? builder : pick(rand, PRINCIPALS);
  // A co-signer can only be another principal who actually signs: the adversary's other principal.
  const signers: Name[] = [];
  if (honest || rand() < 0.85) signers.push(builder);
  if (!honest && rand() < 0.3)
    signers.push(
      pick(
        rand,
        ADVERSARY.filter((a) => a !== builder),
      ),
    );
  const spec: IntentSpec = { builder, claimActor, claimKey, signers };
  const predicted = predictAcceptIntent(w, spec);
  const result = await attemptIntent(w, spec);
  w.steps.push(
    `intent(builder=${builder} claim=${claimActor}/${claimKey} signers=[${signers}]) predicted=${predicted} -> ${result.status}`,
  );
  expect(
    result.accepted,
    `API disagrees with the model\n${w.steps.join('\n')}\n${result.body}`,
  ).toBe(predicted);
  if (result.accepted) {
    w.artifacts.set(result.artifactId, builder);
    w.authoredBy.set(result.envelope.payloadDigest, builder);
  }
}

/**
 * An event with no artifact body (`external_import`): nothing but the ledger's own
 * attribution rules stand between a forger and the actor they claim to be. This is
 * the case the artifact authoring-signature check cannot cover.
 */
async function actRawEvent(w: World, rand: Rand) {
  const builder = pick(rand, PRINCIPALS);
  const honest = !ADVERSARY.includes(builder);
  const claimActor = honest ? builder : pick(rand, PRINCIPALS);
  const claimKey = honest ? builder : pick(rand, PRINCIPALS);
  const signers: Name[] = [];
  if (honest || rand() < 0.6) signers.push(builder);
  if (!honest && rand() < 0.4)
    signers.push(
      pick(
        rand,
        ADVERSARY.filter((a) => a !== builder),
      ),
    );
  const anchor = (
    await w.server.inject({ method: 'GET', url: '/v1/events?limit=1', headers: headers('alice') })
  ).json().items[0]?.eventId as string | undefined;
  if (!anchor || signers.length === 0) return;
  const event = buildUnsignedEvent({
    eventType: 'external_import',
    actor: { actorId: w.who[claimActor].actorId, keyId: w.who[claimKey].signer.keyId },
    tenant: 'default',
    subject: { kind: 'artifact', artifact_id: generateId() },
    causalParents: [{ event_id: anchor, relation: 'input' }],
    payload: { source: 'model-based test', note: generateId() },
  });
  const envelope = signEnvelope(
    event,
    signers.map((n) => w.who[n].signer),
  );
  // WritePath.tla `Accept`: the claimed key signed, belongs to the claimed actor, and every signer is trusted.
  const predicted =
    claimActor === claimKey && signers.includes(claimKey) && signers.every((n) => usable(w, n));
  const res = await post(w, '/v1/artifacts', builder, envelope);
  w.steps.push(
    `rawEvent(builder=${builder} claim=${claimActor}/${claimKey} signers=[${signers}]) predicted=${predicted} -> ${res.statusCode}`,
  );
  expect(
    res.statusCode === 201,
    `API disagrees with the model\n${w.steps.join('\n')}\n${res.body}`,
  ).toBe(predicted);
  if (res.statusCode === 201) w.authoredBy.set(envelope.payloadDigest, builder);
}

/** A genesis for someone else's artifact id (WritePath: NoArtifactTakeover). */
async function actTakeoverArtifact(w: World, rand: Rand) {
  const entries = [...w.artifacts.entries()];
  if (entries.length === 0) return;
  const [artifactId, creator] = pick(rand, entries);
  const builder = pick(rand, ADVERSARY);
  if (!usable(w, builder)) return;
  const spec: IntentSpec = {
    builder,
    claimActor: builder,
    claimKey: builder,
    signers: [builder],
    artifactId,
  };
  const result = await attemptIntent(w, spec);
  w.steps.push(`takeoverArtifact(${builder} on ${creator}'s artifact) -> ${result.status}`);
  // Only the creator may open a second root; anyone else is refused.
  expect(result.accepted, w.steps.join('\n')).toBe(builder === creator);
  if (result.accepted) w.authoredBy.set(result.envelope.payloadDigest, builder);
}

async function actRevoke(w: World, rand: Rand) {
  const builder = pick(rand, PRINCIPALS);
  const target = rand() < 0.7 ? builder : pick(rand, PRINCIPALS);
  const targetKey = w.who[target];
  const parent = (
    await w.server.inject({ method: 'GET', url: '/v1/events?limit=1', headers: headers('alice') })
  ).json().items[0]?.eventId as string | undefined;
  if (!parent) return;
  const artifact = buildArtifactEnvelope({
    actor: w.who[builder],
    artifactType: 'Key',
    data: {
      key_id: targetKey.signer.keyId,
      algorithm: 'ed25519',
      public_key: targetKey.signer.publicKey,
      status: 'revoked',
      owner_actor_id: targetKey.actorId,
    },
  });
  const event = buildUnsignedEvent({
    eventType: 'key_revoked',
    actor: { actorId: w.who[builder].actorId, keyId: w.who[builder].signer.keyId },
    tenant: 'default',
    subject: {
      kind: 'artifact',
      artifact_id: artifact.artifact_id as string,
      version_id: artifact.version_id as string,
      artifact_type: 'Key',
    },
    causalParents: [{ event_id: parent, relation: 'revision-of' }],
    payload: artifact,
  });
  // WritePath.tla `RevokeKey`: a trusted key of the same owner, on an active target.
  const predicted = builder === target && usable(w, builder);
  const res = await post(w, '/v1/keys', builder, signEnvelope(event, [w.who[builder].signer]));
  w.steps.push(
    `revoke(builder=${builder} target=${target}) predicted=${predicted} -> ${res.statusCode}`,
  );
  expect(res.statusCode === 201, `${w.steps.join('\n')}\n${res.body}`).toBe(predicted);
  if (res.statusCode === 201) w.revoked.add(target);
}

async function actApprovalRequest(w: World, rand: Rand) {
  const requester = pick(
    rand,
    PRINCIPALS.filter((n) => usable(w, n)),
  );
  if (!requester) return;
  const anchor = [...w.authoredBy.keys()][0];
  const intents = [...w.artifacts.keys()];
  if (!anchor || intents.length === 0) return;
  const artifactId = pick(rand, intents);
  const events = (
    await w.server.inject({
      method: 'GET',
      url: `/v1/history/${artifactId}`,
      headers: headers('alice'),
    })
  ).json().items;
  const versionId = events[0].subjectVersionId as string;
  const built = buildApprovalRequestEnvelope(
    w.who[requester],
    artifactId,
    versionId,
    events[0].eventId,
  );
  const res = await post(w, '/v1/approval-requests', requester, built.envelope);
  w.steps.push(`approvalRequest(${requester}) -> ${res.statusCode}`);
  expect(res.statusCode, `${w.steps.join('\n')}\n${res.body}`).toBe(201);
  w.requests.set(built.requestId, {
    requester,
    artifactId,
    versionId,
    eventId: res.json().eventId,
    anchor: events[0].eventId,
  });
}

async function actApprovalDecision(w: World, rand: Rand) {
  const reviewer = pick(rand, PRINCIPALS);
  const known = [...w.requests.entries()];
  const useUnknown = known.length === 0 || rand() < 0.2;
  const [requestId, req] = useUnknown
    ? [
        generateId(),
        {
          requester: reviewer,
          artifactId: generateId(),
          versionId: `sha-256:${'1'.repeat(64)}`,
          eventId: [...w.authoredBy.keys()][0] ?? 'x',
          anchor: [...w.authoredBy.keys()][0] ?? 'x',
        },
      ]
    : pick(rand, known);
  if (!w.authoredBy.size) return;
  const envelope = buildApprovalDecisionEnvelope(
    w.who[reviewer],
    requestId,
    req.artifactId,
    req.versionId,
    req.eventId,
  );
  // ApprovalAuthorization.tla `Decide`: existing request, once per reviewer, signer is a usable key.
  const exists = w.requests.has(requestId);
  const predicted = exists && !w.decided.has(`${requestId}|${reviewer}`) && usable(w, reviewer);
  const res = await post(w, '/v1/approval-decisions', reviewer, envelope);
  w.steps.push(
    `approvalDecision(${reviewer}, ${exists ? 'known' : 'unknown'} request) predicted=${predicted} -> ${res.statusCode}`,
  );
  expect(res.statusCode === 201, `${w.steps.join('\n')}\n${res.body}`).toBe(predicted);
  if (res.statusCode === 201) w.decided.add(`${requestId}|${reviewer}`);
}

// ------------------------------------------------------------------ invariants

async function checkInvariants(w: World) {
  const events: {
    eventId: string;
    sequence: number;
    eventType: string;
    envelope: SignedEnvelope;
  }[] = [];
  let cursor = '-1';
  for (;;) {
    const page = (
      await w.server.inject({
        method: 'GET',
        url: `/v1/events?limit=100&cursor=${cursor}`,
        headers: headers('alice'),
      })
    ).json();
    events.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  const keyOwner = new Map<string, Name>(PRINCIPALS.map((n) => [w.who[n].signer.keyId, n]));
  const actorOwner = new Map<string, Name>(PRINCIPALS.map((n) => [w.who[n].actorId, n]));
  const revokedAt = new Map<Name, number>();
  const ctx = (msg: string) => `${msg}\n${w.steps.join('\n')}`;

  // Pass 1: when was each key revoked?
  for (const e of events) {
    if (e.eventType !== 'key_revoked') continue;
    const data = (e.envelope.payload as any).payload.data;
    revokedAt.set(keyOwner.get(data.key_id)!, e.sequence);
  }

  const genesisBy = new Map<string, Name>();
  for (const e of events) {
    const p = e.envelope.payload as any;
    const signerKeys: string[] = e.envelope.signatures.map((s) => s.key_id);

    // NoForgedAttribution: the actor key signed the event, and belongs to the actor the event names.
    expect(signerKeys, ctx(`event ${e.sequence} not signed by its own actor key`)).toContain(
      p.actor.key_id,
    );
    expect(
      actorOwner.get(p.actor.actor_id),
      ctx(`event ${e.sequence}: actor does not own the signing key`),
    ).toBe(keyOwner.get(p.actor.key_id));

    // An honest principal's key is never used except by the harness building their own events.
    const owner = keyOwner.get(p.actor.key_id)!;
    if (!ADVERSARY.includes(owner) && w.authoredBy.has(e.eventId)) {
      expect(
        w.authoredBy.get(e.eventId),
        ctx(`event ${e.sequence} attributed to an honest actor who did not author it`),
      ).toBe(owner);
    }

    // NoRevokedKeyAccepted: nothing is accepted under a key after its revocation event.
    const ended = revokedAt.get(owner);
    if (ended !== undefined && e.sequence > ended) {
      throw new Error(
        ctx(`event ${e.sequence} accepted under ${owner}'s key, revoked at ${ended}`),
      );
    }

    // NoArtifactTakeover: one actor owns every genesis of an artifact id.
    if (e.eventType === 'genesis' && p.subject.kind === 'artifact') {
      const prior = genesisBy.get(p.subject.artifact_id);
      expect(
        prior === undefined || prior === owner,
        ctx(`artifact ${p.subject.artifact_id} has genesis events by two actors`),
      ).toBe(true);
      genesisBy.set(p.subject.artifact_id, owner);
    }
  }

  // ReceiptChainIntegrity / NoDuplicateReceipts / AtomicEventAndReceipt over the real receipt log.
  const ids = new Set<string>();
  let previous: Awaited<ReturnType<LedgerContext['ledger']['getReceipt']>> = null;
  for (const e of events) {
    expect(e.sequence, ctx('sequence gap or repeat')).toBe(previous ? previous.sequence + 1 : 0);
    const receipt = (await w.ctx.ledger.getReceipt(e.sequence))!;
    expect(receipt, ctx(`event ${e.sequence} has no receipt`)).not.toBeNull();
    expect(receipt.event_id).toBe(e.eventId);
    const check = verifyReceipt(receipt, w.ctx.ledgerSigner.publicKey, previous);
    expect(check, ctx(`receipt ${e.sequence} does not verify or chain`)).toEqual({
      digestValid: true,
      signatureValid: true,
      chainLinkValid: true,
    });
    expect(ids.has(e.eventId), ctx(`duplicate event ${e.eventId}`)).toBe(false);
    ids.add(e.eventId);
    previous = receipt;
  }

  // Approval lifecycle: every decision names an existing request, once per reviewer.
  const requestIds = new Set<string>();
  const seenDecision = new Set<string>();
  for (const e of events) {
    const p = e.envelope.payload as any;
    if (e.eventType === 'approval_requested') requestIds.add(p.payload.data.request.request_id);
    if (e.eventType === 'approval_decided') {
      const d = p.payload.data.decision;
      expect(requestIds.has(d.request_id), ctx('decision without a prior request')).toBe(true);
      const key = `${d.request_id}|${d.reviewer.actor_id}`;
      expect(seenDecision.has(key), ctx('reviewer decided a request twice')).toBe(false);
      seenDecision.add(key);
    }
  }
}

// --------------------------------------------------------------------- driver

const ACTIONS: { weight: number; run: (w: World, r: Rand) => Promise<void> }[] = [
  { weight: 3, run: actRegister },
  { weight: 2, run: actKeyTakeover },
  { weight: 6, run: actIntent },
  { weight: 5, run: actRawEvent },
  { weight: 2, run: actTakeoverArtifact },
  { weight: 1, run: actRevoke },
  { weight: 2, run: actApprovalRequest },
  { weight: 3, run: actApprovalDecision },
];

async function runSequence(seed: number, steps: number) {
  const rand = rng(seed);
  const w = await newWorld();
  try {
    // Start with the honest principals registered so most steps reach the interesting guards.
    for (const n of ['alice', 'bob'] as Name[]) {
      expect(
        (await post(w, '/v1/keys', n, buildKeyRegistrationEnvelope(w.who[n]))).statusCode,
      ).toBe(201);
      w.registered.add(n);
      await post(w, '/v1/actors', n, buildActorRegistrationEnvelope(w.who[n], n));
    }
    const total = ACTIONS.reduce((sum, a) => sum + a.weight, 0);
    for (let i = 0; i < steps; i++) {
      let roll = rand() * total;
      const action = ACTIONS.find((a) => (roll -= a.weight) < 0) ?? ACTIONS[0]!;
      await action.run(w, rand);
      await checkInvariants(w);
    }
    return w.steps.length;
  } finally {
    await w.server.close();
  }
}

describe('model-based adversarial test of the real API', () => {
  it('agrees with the TLA+ guards and preserves every model invariant over 40 seeded random runs', async () => {
    let actions = 0;
    for (let seed = 1; seed <= 40; seed++) {
      try {
        actions += await runSequence(seed * 7919, 24);
      } catch (err) {
        throw new Error(
          `seed ${seed * 7919} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    expect(actions).toBeGreaterThan(500);
  }, 600_000);
});
