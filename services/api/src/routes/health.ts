import type { FastifyPluginAsync } from 'fastify';
import type { LedgerContext } from '../ledger-context.js';

const healthRoutes: FastifyPluginAsync<{ ctx: LedgerContext }> = async (fastify, { ctx }) => {
  fastify.get('/v1/health/live', async () => ({ status: 'ok' }));

  fastify.get('/v1/health/ready', async (_request, reply) => {
    try {
      // A real, cheap read against the configured storage backend -- not a
      // hardcoded 200, so a Kubernetes readinessProbe (or Compose
      // depends_on healthcheck) genuinely reflects whether this instance
      // can reach its database, not just whether the process is running.
      await ctx.ledger.listEvents(1, -1);
      return { status: 'ok' };
    } catch (err) {
      reply.code(503);
      return { status: 'unavailable', detail: err instanceof Error ? err.message : String(err) };
    }
  });

  fastify.get('/v1/metrics', async (_request, reply) => {
    const memory = process.memoryUsage();
    const lines = [
      '# HELP act_process_uptime_seconds Time since the process started.',
      '# TYPE act_process_uptime_seconds gauge',
      `act_process_uptime_seconds ${process.uptime()}`,
      '# HELP act_nodejs_memory_rss_bytes Resident set size.',
      '# TYPE act_nodejs_memory_rss_bytes gauge',
      `act_nodejs_memory_rss_bytes ${memory.rss}`,
      '# HELP act_nodejs_memory_heap_used_bytes V8 heap actually in use.',
      '# TYPE act_nodejs_memory_heap_used_bytes gauge',
      `act_nodejs_memory_heap_used_bytes ${memory.heapUsed}`,
    ];
    reply.header('content-type', 'text/plain; version=0.0.4');
    return lines.join('\n') + '\n';
  });
};

export default healthRoutes;
