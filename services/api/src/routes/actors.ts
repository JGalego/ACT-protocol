import type { FastifyPluginAsync } from 'fastify';
import { badRequest } from '../problem.js';
import type { LedgerContext } from '../ledger-context.js';
import { parseSignedEnvelope, submitEnvelope } from './shared.js';

/**
 * Registers an Actor. The signing key MUST already be registered via
 * POST /v1/keys (that endpoint is this API's trust bootstrap); this keeps
 * exactly one code path responsible for proof-of-possession.
 */
const actorRoutes: FastifyPluginAsync<{ ctx: LedgerContext }> = async (fastify, { ctx }) => {
  fastify.post('/v1/actors', async (request, reply) => {
    const envelope = parseSignedEnvelope(request.body);
    const eventPayload = envelope.payload as { actor: { key_id: string } };

    if (!ctx.keyRegistry.get(eventPayload.actor.key_id)) {
      throw badRequest(
        'unknown_signing_key',
        'The signing key must be registered via POST /v1/keys before it can register an Actor',
      );
    }

    const result = await submitEnvelope(ctx.ledger, ctx.keyRegistry, envelope, {
      allowedEventTypes: ['genesis', 'actor_registered'],
      allowedSubjectKinds: ['artifact'],
    });
    reply.code(201).send(result);
  });
};

export default actorRoutes;
