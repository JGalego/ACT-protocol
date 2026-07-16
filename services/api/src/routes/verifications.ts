import type { FastifyPluginAsync } from 'fastify';
import type { LedgerContext } from '../ledger-context.js';
import { parseSignedEnvelope, submitEnvelope, validateArtifactTypePayload } from './shared.js';

const verificationRoutes: FastifyPluginAsync<{ ctx: LedgerContext }> = async (fastify, { ctx }) => {
  fastify.post('/v1/verifications', async (request, reply) => {
    const envelope = parseSignedEnvelope(request.body);
    validateArtifactTypePayload(envelope.payload.payload, 'verification-report');
    const result = submitEnvelope(ctx.ledger, ctx.keyRegistry, envelope, {
      allowedEventTypes: ['verification_recorded'],
      allowedSubjectKinds: ['attestation'],
    });
    reply.code(201).send(result);
  });

  fastify.get('/v1/verifications/:id', async (request) => {
    const { id } = request.params as { id: string };
    const event = ctx.ledger.getEvent(id);
    return { event };
  });
};

export default verificationRoutes;
