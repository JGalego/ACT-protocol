import type { FastifyPluginAsync } from 'fastify';
import { checkLineageCompleteness } from '@act/verification';
import { notFound } from '../problem.js';
import { parseIntParam } from './shared.js';

const lineageRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/v1/lineage/:id', async (request) => {
    const ctx = request.ctx;
    const { id } = request.params as { id: string };
    const { maxDepth } = request.query as { maxDepth?: string };
    if (!(await ctx.ledger.getEvent(id))) throw notFound(`No event found with id ${id}`);
    const lineage = await ctx.ledger.getLineage(
      id,
      parseIntParam('maxDepth', maxDepth, { fallback: 50, min: 1, max: 1000 }),
    );
    const findings = checkLineageCompleteness(id, lineage);
    return { eventId: id, lineage, findings };
  });

  fastify.get('/v1/history/:id', async (request) => {
    const ctx = request.ctx;
    const { id } = request.params as { id: string };
    const items = await ctx.ledger.listEventsForArtifact(id);
    return { artifactId: id, items };
  });
};

export default lineageRoutes;
