import type { FastifyPluginAsync } from 'fastify';
import { parseIntParam } from './shared.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

const eventRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/v1/events', async (request) => {
    const ctx = request.ctx;
    const { cursor, limit, eventType, subjectKind } = request.query as {
      cursor?: string;
      limit?: string;
      eventType?: string;
      subjectKind?: string;
    };
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
    const items =
      eventType || subjectKind
        ? await ctx.ledger.queryEvents(
            {
              ...(eventType ? { eventTypes: [eventType] } : {}),
              ...(subjectKind ? { subjectKind } : {}),
            },
            parsedLimit,
            afterSequence,
          )
        : await ctx.ledger.listEvents(parsedLimit, afterSequence);
    const nextCursor =
      items.length === parsedLimit ? String(items[items.length - 1]!.sequence) : null;
    return { items, nextCursor };
  });
};

export default eventRoutes;
