import type { FastifyPluginAsync } from 'fastify';
import { SCHEMA_IDS } from '@act/core';

const schemaRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/v1/schemas', async () => ({
    schemaIds: SCHEMA_IDS,
    note: 'The full schema documents are published under schemas/ in the source repository at each $id path.',
  }));
};

export default schemaRoutes;
