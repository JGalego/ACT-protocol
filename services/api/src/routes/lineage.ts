import type { FastifyPluginAsync } from 'fastify';
import { checkLineageCompleteness } from '@act/verification';
import type { LedgerContext } from '../ledger-context.js';
import { notFound } from '../problem.js';

const lineageRoutes: FastifyPluginAsync<{ ctx: LedgerContext }> = async (fastify, { ctx }) => {
  fastify.get('/v1/lineage/:id', async (request) => {
    const { id } = request.params as { id: string };
    const { maxDepth } = request.query as { maxDepth?: string };
    if (!ctx.ledger.getEvent(id)) throw notFound(`No event found with id ${id}`);
    const lineage = ctx.ledger.getLineage(id, maxDepth ? Number(maxDepth) : undefined);
    const findings = checkLineageCompleteness(id, lineage);
    return { eventId: id, lineage, findings };
  });

  fastify.get('/v1/history/:id', async (request) => {
    const { id } = request.params as { id: string };
    const items = ctx.ledger.listEventsForArtifact(id);
    return { artifactId: id, items };
  });
};

export default lineageRoutes;
