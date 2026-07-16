import type { FastifyPluginAsync } from 'fastify';

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/v1/health/live', async () => ({ status: 'ok' }));
  fastify.get('/v1/health/ready', async () => ({ status: 'ok' }));
};

export default healthRoutes;
