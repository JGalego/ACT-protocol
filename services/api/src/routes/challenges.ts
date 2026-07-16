import type { FastifyPluginAsync } from 'fastify';
import type { LedgerContext } from '../ledger-context.js';
import { parseSignedEnvelope, submitEnvelope, validateArtifactTypePayload } from './shared.js';

const challengeRoutes: FastifyPluginAsync<{ ctx: LedgerContext }> = async (fastify, { ctx }) => {
  fastify.post('/v1/challenges', async (request, reply) => {
    const envelope = parseSignedEnvelope(request.body);
    validateArtifactTypePayload(envelope.payload.payload, 'challenge');
    const result = submitEnvelope(ctx.ledger, ctx.keyRegistry, envelope, {
      allowedEventTypes: ['challenge_raised', 'challenge_resolved'],
      allowedSubjectKinds: ['attestation'],
    });
    reply.code(201).send(result);
  });
};

export default challengeRoutes;
