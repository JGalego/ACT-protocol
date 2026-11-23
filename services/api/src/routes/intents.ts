import type { FastifyPluginAsync } from 'fastify';
import {
  parseSignedEnvelope,
  idempotencyKeyOf,
  submitEnvelope,
  validateArtifactTypePayload,
} from './shared.js';

const intentRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/v1/intents', async (request, reply) => {
    const ctx = request.ctx;
    const envelope = parseSignedEnvelope(request.body);
    validateArtifactTypePayload(envelope.payload.payload, 'intent');
    const result = await submitEnvelope(ctx, envelope, {
      idempotencyKey: idempotencyKeyOf(request),
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
