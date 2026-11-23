import type { FastifyPluginAsync } from 'fastify';
import { notFound } from '../problem.js';
import { isActiveAt } from '../role-registry.js';
import {
  idempotencyKeyOf,
  parseSignedEnvelope,
  submitEnvelope,
  validateArtifactTypePayload,
} from './shared.js';

/**
 * Accountability assignments (spec section 8.4, ADR 0011): who holds which role
 * for which scope. Recording one is an authority decision enforced in
 * semantics.ts (an administrator, or an owner of the scope, never to
 * themselves); reading them shows exactly what the next authority decision
 * will be evaluated against.
 */
const assignmentRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/v1/assignments', async (request, reply) => {
    const ctx = request.ctx;
    const envelope = parseSignedEnvelope(request.body);
    validateArtifactTypePayload(envelope.payload.payload, 'accountability-assignment');
    const result = await submitEnvelope(ctx, envelope, {
      idempotencyKey: idempotencyKeyOf(request),
      allowedEventTypes: ['accountability_assigned'],
      allowedSubjectKinds: ['artifact'],
    });
    reply.code(201).send(result);
  });

  fastify.get('/v1/assignments', async (request) => {
    const ctx = request.ctx;
    const { actor, scope, active } = request.query as {
      actor?: string;
      scope?: string;
      active?: string;
    };
    await ctx.roleRegistry.catchUp(ctx.ledger);
    const nowMs = Date.now();
    const items = ctx.roleRegistry
      .list({
        ...(actor ? { actorId: actor } : {}),
        ...(scope ? { scope } : {}),
        ...(active === 'true' ? { activeAtMs: nowMs } : {}),
      })
      .map((a) => ({ ...a, activeNow: isActiveAt(a, nowMs) }));
    return { items };
  });

  fastify.get('/v1/assignments/:id', async (request) => {
    const ctx = request.ctx;
    const { id } = request.params as { id: string };
    await ctx.roleRegistry.catchUp(ctx.ledger);
    const assignment = ctx.roleRegistry.get(id);
    if (!assignment) throw notFound(`No accountability assignment ${id}`);
    return { ...assignment, activeNow: isActiveAt(assignment, Date.now()) };
  });
};

export default assignmentRoutes;
