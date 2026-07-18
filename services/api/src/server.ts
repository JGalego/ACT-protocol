import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { createLedgerContext, type LedgerContext } from './ledger-context.js';
import authPlugin from './plugins/auth.js';
import type { OidcConfig } from './oidc/jwt-verifier.js';
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
import federationRoutes from './routes/federation.js';
import schemaRoutes from './routes/schemas.js';

export interface BuildServerOptions {
  dbPath?: string;
  devMode?: boolean;
  bodyLimitBytes?: number;
  rateLimitMax?: number;
  ledgerContext?: LedgerContext;
  /** Overrides process.env.NODE_ENV for the production fail-closed check; exposed for tests. */
  nodeEnv?: string;
  /** Production OIDC/JWT validation config; falls back to ACT_OIDC_ISSUER/ACT_OIDC_AUDIENCE/ACT_OIDC_JWKS_URI. */
  oidc?: OidcConfig | undefined;
}

function resolveOidcConfig(options: BuildServerOptions): OidcConfig | undefined {
  if (options.oidc) return options.oidc;
  const issuer = process.env.ACT_OIDC_ISSUER;
  const audience = process.env.ACT_OIDC_AUDIENCE;
  if (!issuer || !audience) return undefined;
  return { issuer, audience, jwksUri: process.env.ACT_OIDC_JWKS_URI };
}

/**
 * Builds (but does not start listening on) a fully wired Fastify instance.
 * Exported separately from `start()` so tests can build an in-memory
 * instance with `.inject()` without binding a real port.
 */
export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const devMode = options.devMode ?? process.env.ACT_DEV_MODE === 'true';
  const oidc = resolveOidcConfig(options);

  if (nodeEnv === 'production') {
    if (devMode) {
      // The local development bearer scheme grants identity with no
      // cryptographic proof; ADR 0006 and docs/security-and-privacy-guide.md
      // require it to be unavailable in production regardless of how it was
      // enabled.
      throw new Error(
        'ACT_DEV_MODE must not be enabled in production. Configure OIDC (ACT_OIDC_ISSUER, ACT_OIDC_AUDIENCE) instead.',
      );
    }
    if (!oidc) {
      // Fail closed: rather than silently accept unauthenticated callers,
      // refuse to start until real OIDC validation is configured.
      throw new Error(
        'Production mode requires OIDC configuration: set ACT_OIDC_ISSUER and ACT_OIDC_AUDIENCE ' +
          '(optionally ACT_OIDC_JWKS_URI to skip discovery).',
      );
    }
  }

  const fastify = Fastify({
    logger: nodeEnv !== 'test',
    bodyLimit: options.bodyLimitBytes ?? 2 * 1024 * 1024,
  });

  await fastify.register(sensible);
  await fastify.register(cors, { origin: devMode });
  await fastify.register(rateLimit, { max: options.rateLimitMax ?? 200, timeWindow: '1 minute' });
  await fastify.register(errorHandlerPlugin);
  await fastify.register(authPlugin, { devMode, oidc });

  const ctx =
    options.ledgerContext ??
    (await createLedgerContext(options.dbPath ?? process.env.ACT_DB_PATH ?? './data/act.db'));

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
  await fastify.register(federationRoutes, { ctx });

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
