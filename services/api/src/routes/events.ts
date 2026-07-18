import type { FastifyPluginAsync } from 'fastify';
import type { LedgerContext } from '../ledger-context.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

const eventRoutes: FastifyPluginAsync<{ ctx: LedgerContext }> = async (fastify, { ctx }) => {
  fastify.get('/v1/events', async (request) => {
    const { cursor, limit } = request.query as { cursor?: string; limit?: string };
    const parsedLimit = Math.min(limit ? Number(limit) : DEFAULT_LIMIT, MAX_LIMIT);
    const afterSequence = cursor ? Number(cursor) : -1;
    const items = await ctx.ledger.listEvents(parsedLimit, afterSequence);
    const nextCursor =
      items.length === parsedLimit ? String(items[items.length - 1]!.sequence) : null;
    return { items, nextCursor };
  });
};

export default eventRoutes;
