import type { FastifyPluginAsync } from 'fastify';
import type { LedgerContext } from '../ledger-context.js';
import { parseSignedEnvelope, submitEnvelope, validateArtifactTypePayload } from './shared.js';

const CHALLENGE_EVENT_TYPES = ['challenge_raised', 'challenge_resolved'];
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

const challengeRoutes: FastifyPluginAsync<{ ctx: LedgerContext }> = async (fastify, { ctx }) => {
  fastify.post('/v1/challenges', async (request, reply) => {
    const envelope = parseSignedEnvelope(request.body);
    validateArtifactTypePayload(envelope.payload.payload, 'challenge');
    const result = await submitEnvelope(ctx.ledger, ctx.keyRegistry, envelope, {
      allowedEventTypes: CHALLENGE_EVENT_TYPES,
      allowedSubjectKinds: ['attestation'],
    });
    reply.code(201).send(result);
  });

  fastify.get('/v1/challenges', async (request) => {
    const { cursor, limit } = request.query as { cursor?: string; limit?: string };
    const parsedLimit = Math.min(limit ? Number(limit) : DEFAULT_LIMIT, MAX_LIMIT);
    const afterSequence = cursor ? Number(cursor) : -1;
    const items = await ctx.ledger.queryEvents(
      { eventTypes: CHALLENGE_EVENT_TYPES },
      parsedLimit,
      afterSequence,
    );
    const nextCursor =
      items.length === parsedLimit ? String(items[items.length - 1]!.sequence) : null;
    return { items, nextCursor };
  });
};

export default challengeRoutes;
