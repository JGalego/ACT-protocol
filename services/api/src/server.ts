import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { createLedgerContext, type LedgerContext } from './ledger-context.js';
import authPlugin from './plugins/auth.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import healthRoutes from './routes/health.js';
import keyRoutes from './routes/keys.js';
import actorRoutes from './routes/actors.js';
import intentRoutes from './routes/intents.js';
import transformationRoutes from './routes/transformations.js';
import artifactRoutes from './routes/artifacts.js';
import approvalRoutes from './routes/approvals.js';
import challengeRoutes from './routes/challenges.js';
import verificationRoutes from './routes/verifications.js';
import policyRoutes from './routes/policies.js';
import lineageRoutes from './routes/lineage.js';
import eventRoutes from './routes/events.js';
import bundleRoutes from './routes/bundles.js';
import schemaRoutes from './routes/schemas.js';

export interface BuildServerOptions {
  dbPath?: string;
  devMode?: boolean;
  bodyLimitBytes?: number;
  rateLimitMax?: number;
  ledgerContext?: LedgerContext;
  /** Overrides process.env.NODE_ENV for the production fail-closed check; exposed for tests. */
  nodeEnv?: string;
}

/**
 * Builds (but does not start listening on) a fully wired Fastify instance.
 * Exported separately from `start()` so tests can build an in-memory
 * instance with `.inject()` without binding a real port.
 */
export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const devMode = options.devMode ?? process.env.ACT_DEV_MODE === 'true';

  if (nodeEnv === 'production' && !devMode) {
    // Fail closed: this release candidate has not yet implemented OIDC/JWT
    // validation (see docs/roadmap.md). Rather than silently accept
    // unauthenticated callers, refuse to start.
    throw new Error(
      'Production mode requires OIDC-validated authentication, which is not yet implemented in this release candidate. ' +
        'Set ACT_DEV_MODE=true only for local/embedded, non-production deployments.',
    );
  }

  const fastify = Fastify({
    logger: nodeEnv !== 'test',
    bodyLimit: options.bodyLimitBytes ?? 2 * 1024 * 1024,
  });

  await fastify.register(sensible);
  await fastify.register(cors, { origin: devMode });
  await fastify.register(rateLimit, { max: options.rateLimitMax ?? 200, timeWindow: '1 minute' });
  await fastify.register(errorHandlerPlugin);
  await fastify.register(authPlugin, { devMode });

  const ctx =
    options.ledgerContext ??
    createLedgerContext(options.dbPath ?? process.env.ACT_DB_PATH ?? './data/act.db');

  await fastify.register(healthRoutes);
  await fastify.register(schemaRoutes);
  await fastify.register(keyRoutes, { ctx });
  await fastify.register(actorRoutes, { ctx });
  await fastify.register(intentRoutes, { ctx });
  await fastify.register(transformationRoutes, { ctx });
  await fastify.register(artifactRoutes, { ctx });
  await fastify.register(approvalRoutes, { ctx });
  await fastify.register(challengeRoutes, { ctx });
  await fastify.register(verificationRoutes, { ctx });
  await fastify.register(policyRoutes, { ctx });
  await fastify.register(lineageRoutes, { ctx });
  await fastify.register(eventRoutes, { ctx });
  await fastify.register(bundleRoutes, { ctx });

  return fastify;
}

async function start(): Promise<void> {
  const port = process.env.PORT ? Number(process.env.PORT) : 4000;
  const host = process.env.HOST ?? '0.0.0.0';
  const server = await buildServer();
  await server.listen({ port, host });
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
