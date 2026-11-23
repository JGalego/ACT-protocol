import type { FastifyPluginAsync } from 'fastify';
import { badRequest } from '../problem.js';
import { idempotencyKeyOf, parseSignedEnvelope, submitEnvelope } from './shared.js';

/**
 * Registers an Actor. The signing key MUST already be registered via
 * POST /v1/keys (that endpoint is this API's trust bootstrap); this keeps
 * exactly one code path responsible for proof-of-possession.
 */
const actorRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/v1/actors', async (request, reply) => {
    const ctx = request.ctx;
    const envelope = parseSignedEnvelope(request.body);
    const event = envelope.payload as {
      actor: { actor_id: string; key_id: string };
      subject: { artifact_id?: string };
    };

    await ctx.keyRegistry.catchUp(ctx.ledger);
    if (!ctx.keyRegistry.get(event.actor.key_id)) {
      throw badRequest(
        'unknown_signing_key',
        'The signing key must be registered via POST /v1/keys before it can register an Actor',
      );
    }
    // An actor record describes the actor that signs it; nobody registers an identity on another's behalf.
    if (event.subject.artifact_id !== event.actor.actor_id) {
      throw badRequest(
        'actor_id_mismatch',
        'An Actor artifact id must equal the actor_id of the actor registering it',
      );
    }

    const result = await submitEnvelope(ctx, envelope, {
      idempotencyKey: idempotencyKeyOf(request),
      allowedEventTypes: ['genesis', 'actor_registered'],
      allowedSubjectKinds: ['artifact'],
    });
    reply.code(201).send(result);
  });
};

export default actorRoutes;
