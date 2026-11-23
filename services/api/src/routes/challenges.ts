import type { FastifyPluginAsync } from 'fastify';
import {
  parseSignedEnvelope,
  idempotencyKeyOf,
  parseIntParam,
  submitEnvelope,
  validateArtifactTypePayload,
} from './shared.js';

const CHALLENGE_EVENT_TYPES = ['challenge_raised', 'challenge_resolved'];
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

const challengeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/v1/challenges', async (request, reply) => {
    const ctx = request.ctx;
    const envelope = parseSignedEnvelope(request.body);
    validateArtifactTypePayload(envelope.payload.payload, 'challenge');
    const result = await submitEnvelope(ctx, envelope, {
      idempotencyKey: idempotencyKeyOf(request),
      allowedEventTypes: CHALLENGE_EVENT_TYPES,
      allowedSubjectKinds: ['attestation'],
    });
    reply.code(201).send(result);
  });

  fastify.get('/v1/challenges', async (request) => {
    const ctx = request.ctx;
    const { cursor, limit } = request.query as { cursor?: string; limit?: string };
    const parsedLimit = parseIntParam('limit', limit, {
      fallback: DEFAULT_LIMIT,
      min: 1,
      max: MAX_LIMIT,
    });
    const afterSequence = parseIntParam('cursor', cursor, {
      fallback: -1,
      min: -1,
      max: Number.MAX_SAFE_INTEGER,
    });
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
