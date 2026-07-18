import type { FastifyPluginAsync } from 'fastify';
import type { LedgerContext } from '../ledger-context.js';
import { parseSignedEnvelope, submitEnvelope, validateArtifactTypePayload } from './shared.js';

const intentRoutes: FastifyPluginAsync<{ ctx: LedgerContext }> = async (fastify, { ctx }) => {
  fastify.post('/v1/intents', async (request, reply) => {
    const envelope = parseSignedEnvelope(request.body);
    validateArtifactTypePayload(envelope.payload.payload, 'intent');
    const result = await submitEnvelope(ctx.ledger, ctx.keyRegistry, envelope, {
      allowedEventTypes: [
        'genesis',
        'artifact_revised',
        'intent_effective_selected',
        'intent_merged',
      ],
      allowedSubjectKinds: ['artifact'],
    });
    reply.code(201).send(result);
  });
};

export default intentRoutes;
