import type { FastifyPluginAsync } from 'fastify';
import type { LedgerContext } from '../ledger-context.js';
import { parseSignedEnvelope, submitEnvelope, validateArtifactTypePayload } from './shared.js';

const policyRoutes: FastifyPluginAsync<{ ctx: LedgerContext }> = async (fastify, { ctx }) => {
  fastify.post('/v1/policies', async (request, reply) => {
    const envelope = parseSignedEnvelope(request.body);
    validateArtifactTypePayload(envelope.payload.payload, 'policy');
    const result = submitEnvelope(ctx.ledger, ctx.keyRegistry, envelope, {
      allowedEventTypes: ['policy_published'],
      allowedSubjectKinds: ['policy'],
    });
    reply.code(201).send(result);
  });
};

export default policyRoutes;
