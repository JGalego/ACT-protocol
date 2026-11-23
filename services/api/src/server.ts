import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import {
  createTenantRegistry,
  type AuthorityConfig,
  type LedgerContext,
  type ServerPolicy,
} from './ledger-context.js';
import authPlugin from './plugins/auth.js';
import tenantPlugin from './plugins/tenant.js';
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
  /** A ready default-tenant context (tests, embedding); its registry serves every other tenant too. */
  ledgerContext?: LedgerContext;
  /** Refuse callers whose credentials name no tenant instead of using `default`; falls back to ACT_REQUIRE_TENANT. Default: true in production. */
  requireTenant?: boolean | undefined;
  /** Only these tenants may exist; falls back to ACT_TENANTS (comma-separated). */
  allowedTenants?: string[] | undefined;
  /** Overrides process.env.NODE_ENV for the production fail-closed check; exposed for tests. */
  nodeEnv?: string;
  /** Production OIDC/JWT validation config; falls back to ACT_OIDC_ISSUER/ACT_OIDC_AUDIENCE/ACT_OIDC_JWKS_URI. */
  oidc?: OidcConfig | undefined;
  /** Actor ids that may administer peers, imports and (in admin mode) key registration; falls back to ACT_ADMIN_ACTORS (comma-separated). */
  adminActorIds?: string[] | undefined;
  /** `open` or `admin`; falls back to ACT_KEY_REGISTRATION. Default: `open` in dev mode, `admin` otherwise. */
  keyRegistration?: 'open' | 'admin' | undefined;
  /** Permit loopback/private federation peers; falls back to ACT_ALLOW_PRIVATE_PEERS. Default: dev mode only. */
  allowPrivatePeers?: boolean | undefined;
  /** Authority policy + role assignments for selecting/merging effective intents; falls back to the JSON file at ACT_AUTHORITY_POLICY_FILE. */
  authority?: AuthorityConfig | undefined;
}

function resolveAdminActors(options: BuildServerOptions): string[] | undefined {
  if (options.adminActorIds) return options.adminActorIds;
  const raw = process.env.ACT_ADMIN_ACTORS;
  if (!raw) return undefined;
  return raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function resolveAuthority(options: BuildServerOptions): AuthorityConfig | undefined {
  if (options.authority) return options.authority;
  const file = process.env.ACT_AUTHORITY_POLICY_FILE;
  return file ? (JSON.parse(readFileSync(file, 'utf8')) as AuthorityConfig) : undefined;
}

function resolveKeyRegistration(options: BuildServerOptions, devMode: boolean): 'open' | 'admin' {
  const value = options.keyRegistration ?? process.env.ACT_KEY_REGISTRATION;
  if (value === 'open' || value === 'admin') return value;
  if (value !== undefined) {
    throw new Error(`ACT_KEY_REGISTRATION must be 'open' or 'admin', got '${value}'`);
  }
  return devMode ? 'open' : 'admin';
}

function resolveRequireTenant(options: BuildServerOptions, nodeEnv: string): boolean {
  if (options.requireTenant !== undefined) return options.requireTenant;
  const value = process.env.ACT_REQUIRE_TENANT;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value !== undefined) {
    throw new Error(`ACT_REQUIRE_TENANT must be 'true' or 'false', got '${value}'`);
  }
  return nodeEnv === 'production';
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

  const adminActorIds = resolveAdminActors(options);
  if (nodeEnv === 'production' && (!adminActorIds || adminActorIds.length === 0)) {
    // Peers, federation imports and key admission are administrator
    // operations; a production server with no administrator cannot be
    // operated, and one that treated everyone as an administrator would be
    // wide open. Refuse to start rather than guess.
    throw new Error(
      'Production mode requires at least one administrator: set ACT_ADMIN_ACTORS to the OIDC subject(s) allowed to administer this ledger.',
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
  await fastify.register(authPlugin, {
    devMode,
    oidc,
    requireTenant: resolveRequireTenant(options, nodeEnv),
  });

  const registry =
    options.ledgerContext?.registry ??
    (await createTenantRegistry(options.dbPath ?? process.env.ACT_DB_PATH ?? './data/act.db', {
      ...(options.allowedTenants ? { allowedTenants: options.allowedTenants } : {}),
    }));
  await fastify.register(tenantPlugin, { registry });

  const policy: ServerPolicy = {
    devMode,
    adminActorIds,
    keyRegistration: resolveKeyRegistration(options, devMode),
    allowPrivatePeers:
      options.allowPrivatePeers ?? (process.env.ACT_ALLOW_PRIVATE_PEERS === 'true' || devMode),
    authority: resolveAuthority(options),
  };
  // Shared by reference with every tenant context, present and future.
  Object.assign(registry.policy, policy);

  await fastify.register(healthRoutes, { registry });
  await fastify.register(schemaRoutes);
  await fastify.register(keyRoutes);
  await fastify.register(actorRoutes);
  await fastify.register(intentRoutes);
  await fastify.register(transformationRoutes);
  await fastify.register(artifactRoutes);
  await fastify.register(approvalRoutes);
  await fastify.register(challengeRoutes);
  await fastify.register(verificationRoutes);
  await fastify.register(policyRoutes);
  await fastify.register(lineageRoutes);
  await fastify.register(eventRoutes);
  await fastify.register(bundleRoutes);
  await fastify.register(federationRoutes);

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
