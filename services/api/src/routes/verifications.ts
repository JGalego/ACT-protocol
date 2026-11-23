import type { FastifyPluginAsync } from 'fastify';
import type { LedgerContext } from '../ledger-context.js';
import {
  parseSignedEnvelope,
  idempotencyKeyOf,
  submitEnvelope,
  validateArtifactTypePayload,
} from './shared.js';

const verificationRoutes: FastifyPluginAsync<{ ctx: LedgerContext }> = async (fastify, { ctx }) => {
  fastify.post('/v1/verifications', async (request, reply) => {
    const envelope = parseSignedEnvelope(request.body);
    validateArtifactTypePayload(envelope.payload.payload, 'verification-report');
    const result = await submitEnvelope(ctx, envelope, {
      idempotencyKey: idempotencyKeyOf(request),
      allowedEventTypes: ['verification_recorded'],
      allowedSubjectKinds: ['attestation'],
    });
    reply.code(201).send(result);
  });

  fastify.get('/v1/verifications/:id', async (request) => {
    const { id } = request.params as { id: string };
    const event = await ctx.ledger.getEvent(id);
    return { event };
  });
};

export default verificationRoutes;
