import { generateKeyPair, keyPairFromPrivateKey } from '@act/crypto';
import { Ledger, SqliteAdapter, PostgresAdapter, type StorageAdapter } from '@act/ledger';
import { generateId } from '@act/core';
import type { AuthorityPolicyDocument } from '@act/policy';
import { PeerRegistry } from './peer-registry.js';
import { KeyRegistry } from './key-registry.js';
import { RoleRegistry } from './role-registry.js';
import { ApiProblemError } from './problem.js';
import { DEFAULT_TENANT, isValidTenantId, scopedMeta, type MetaStore } from './tenancy.js';

export { KeyRegistry } from './key-registry.js';

/**
 * Which roles may decide, and how many. Who holds a role is not configuration:
 * it comes from signed accountability assignments in the ledger (ADR 0011).
 */
export interface AuthorityConfig {
  policy: AuthorityPolicyDocument;
}

/** Operator-controlled settings that decide who may do what. Set by `buildServer`. */
export interface ServerPolicy {
  devMode: boolean;
  /** Actor ids allowed to administer peers, imports and (in `admin` mode) key registration. Undefined: everyone in dev mode, no one otherwise. */
  adminActorIds?: string[] | undefined;
  /** `open`: any caller proving possession of a key may register it. `admin`: only admin actors may. */
  keyRegistration: 'open' | 'admin';
  allowPrivatePeers: boolean;
  authority?: AuthorityConfig | undefined;
}

/** One tenant's ledger: its own id, signing key, receipt chain, key registry and peers (ADR 0010). */
export interface LedgerContext {
  tenantId: string;
  /** The registry this tenant context came from; resolves other tenants over the same database. */
  registry: TenantRegistry;
  ledger: Ledger;
  adapter: StorageAdapter;
  keyRegistry: KeyRegistry;
  roleRegistry: RoleRegistry;
  /** This tenant's slice of the shared metadata store (peers, witnesses, checkpoints). */
  meta: MetaStore;
  peerRegistry: PeerRegistry;
  ledgerId: string;
  ledgerSigner: { keyId: string; publicKey: string; privateKey: string };
  policy: ServerPolicy;
}

export interface CreateLedgerContextOptions {
  /** Explicit storage adapter (tests may pass one already open/migrated). Overrides dbPath/connectionString. */
  adapter?: StorageAdapter;
  /** Set via ACT_STORAGE=postgres to select PostgresAdapter instead of SQLite. */
  storage?: 'sqlite' | 'postgres';
  /** Required when storage === 'postgres'; defaults to process.env.ACT_DATABASE_URL. */
  connectionString?: string;
  /** Base64 Ed25519 seed for the default tenant's ledger signing key; defaults to process.env.ACT_LEDGER_PRIVATE_KEY. */
  ledgerPrivateKey?: string;
  /** If set, only these tenants may exist; any other is refused. Falls back to ACT_TENANTS (comma-separated). */
  allowedTenants?: string[];
  /** Upper bound on tenants held in memory at once. Falls back to ACT_MAX_TENANTS; default 1000. */
  maxTenants?: number;
}

interface StoredIdentity {
  ledgerId: string;
  keyId: string;
  publicKey: string;
  /** Absent when the operator supplies the key through the environment instead of the database. */
  privateKey?: string;
}

const IDENTITY_META_KEY = 'ledger_identity';

/**
 * A ledger's identity (id + receipt-signing key) must outlive the process:
 * receipts already issued are signed by it, and peers have pinned it. It is
 * created once and stored in the ledger's own database, which every replica of
 * that database shares. Supplying `ACT_LEDGER_PRIVATE_KEY` keeps the private
 * key out of the database entirely.
 */
async function loadOrCreateIdentity(
  adapter: MetaStore,
  suppliedPrivateKey: string | undefined,
): Promise<{ ledgerId: string; signer: { keyId: string; publicKey: string; privateKey: string } }> {
  const read = async (): Promise<StoredIdentity | null> => {
    const raw = await adapter.getMeta(IDENTITY_META_KEY);
    return raw ? (JSON.parse(raw) as StoredIdentity) : null;
  };

  let stored = await read();
  if (!stored) {
    const pair = suppliedPrivateKey ? keyPairFromPrivateKey(suppliedPrivateKey) : generateKeyPair();
    const candidate: StoredIdentity = {
      ledgerId: generateId(),
      keyId: pair.keyId,
      publicKey: pair.publicKey,
      ...(suppliedPrivateKey ? {} : { privateKey: pair.privateKey }),
    };
    // Replicas starting together all try this; exactly one wins and the rest adopt its identity.
    await adapter.setMetaIfAbsent(IDENTITY_META_KEY, JSON.stringify(candidate));
    stored = (await read())!;
  }

  const privateKey = suppliedPrivateKey ?? stored.privateKey;
  if (!privateKey) {
    throw new Error(
      'This ledger keeps its signing key outside the database: set ACT_LEDGER_PRIVATE_KEY to the key it was created with.',
    );
  }
  const pair = keyPairFromPrivateKey(privateKey);
  if (pair.keyId !== stored.keyId) {
    throw new Error(
      `ACT_LEDGER_PRIVATE_KEY (${pair.keyId}) does not match this ledger's registered signing key (${stored.keyId}); refusing to start.`,
    );
  }
  return { ledgerId: stored.ledgerId, signer: pair };
}

const DEFAULT_MAX_TENANTS = 1000;

/**
 * Hands out one `LedgerContext` per tenant over a single shared database.
 * Contexts are created on first use and cached; each rebuilds its own key
 * registry from its own log, so nothing a tenant did is visible to, or trusted
 * by, another tenant.
 */
export class TenantRegistry {
  /** Shared by every context; `buildServer` fills it in place once the operator's settings are known. */
  readonly policy: ServerPolicy = {
    devMode: false,
    keyRegistration: 'admin',
    allowPrivatePeers: false,
  };
  private readonly contexts = new Map<string, Promise<LedgerContext>>();

  constructor(
    readonly adapter: StorageAdapter,
    private readonly options: {
      ledgerPrivateKey?: string | undefined;
      allowedTenants?: readonly string[] | undefined;
      maxTenants?: number | undefined;
    } = {},
  ) {}

  /** Cheap read proving the shared store is reachable (readiness probe). */
  async ping(): Promise<void> {
    await this.adapter.getMeta('ping');
  }

  /** Resolves a tenant's context. Refuses malformed or disallowed ids; cross-tenant access is not expressible. */
  get(tenantId: string): Promise<LedgerContext> {
    if (!isValidTenantId(tenantId)) {
      return Promise.reject(
        new ApiProblemError(
          400,
          'invalid_tenant',
          'The tenant id is not valid',
          'Tenant ids are 1-64 characters: letters, digits, ".", "_" and "-", starting with a letter or digit',
        ),
      );
    }
    const allowed = this.options.allowedTenants;
    if (allowed && !allowed.includes(tenantId)) {
      return Promise.reject(
        new ApiProblemError(
          403,
          'tenant_not_allowed',
          'This tenant is not provisioned on this server',
        ),
      );
    }
    const cached = this.contexts.get(tenantId);
    if (cached) return cached;
    if (this.contexts.size >= (this.options.maxTenants ?? DEFAULT_MAX_TENANTS)) {
      return Promise.reject(
        new ApiProblemError(
          503,
          'tenant_limit_reached',
          'This server cannot take on another tenant right now',
        ),
      );
    }
    const created = this.create(tenantId);
    this.contexts.set(tenantId, created);
    // A failed start must not be remembered, or the tenant would be locked out until a restart.
    created.catch(() => this.contexts.delete(tenantId));
    return created;
  }

  private async create(tenantId: string): Promise<LedgerContext> {
    const meta = scopedMeta(this.adapter, tenantId);
    // The operator-supplied key is the default tenant's; every other tenant gets its own generated key.
    const supplied = tenantId === DEFAULT_TENANT ? this.options.ledgerPrivateKey : undefined;
    const { ledgerId, signer } = await loadOrCreateIdentity(meta, supplied);
    const keyRegistry = new KeyRegistry();
    const ledger = new Ledger({
      ledgerId,
      adapter: this.adapter,
      signer,
      trustPolicy: keyRegistry,
      tenant: tenantId,
    });
    await keyRegistry.catchUp(ledger);
    const roleRegistry = new RoleRegistry();
    await roleRegistry.catchUp(ledger);
    return {
      tenantId,
      registry: this,
      ledger,
      adapter: this.adapter,
      keyRegistry,
      roleRegistry,
      meta,
      peerRegistry: new PeerRegistry(meta),
      ledgerId,
      ledgerSigner: signer,
      policy: this.policy,
    };
  }
}

/** Opens (and migrates) the shared database and returns the registry that serves every tenant from it. */
export async function createTenantRegistry(
  dbPath: string,
  options: CreateLedgerContextOptions = {},
): Promise<TenantRegistry> {
  const adapter = options.adapter ?? (await openConfiguredAdapter(dbPath, options));
  await adapter.migrate();
  const allowedFromEnv = process.env.ACT_TENANTS?.split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const maxFromEnv = process.env.ACT_MAX_TENANTS ? Number(process.env.ACT_MAX_TENANTS) : undefined;
  if (maxFromEnv !== undefined && (!Number.isInteger(maxFromEnv) || maxFromEnv < 1)) {
    throw new Error('ACT_MAX_TENANTS must be a positive integer');
  }
  const allowedTenants = options.allowedTenants ?? allowedFromEnv;
  for (const tenant of allowedTenants ?? []) {
    if (!isValidTenantId(tenant))
      throw new Error(`ACT_TENANTS: ${JSON.stringify(tenant)} is not a valid tenant id`);
  }
  return new TenantRegistry(adapter, {
    ledgerPrivateKey: options.ledgerPrivateKey ?? process.env.ACT_LEDGER_PRIVATE_KEY,
    allowedTenants,
    maxTenants: options.maxTenants ?? maxFromEnv,
  });
}

/** The default tenant's context over a migrated database (single-tenant callers, tests, the migrate command). */
export async function createLedgerContext(
  dbPath: string,
  options: CreateLedgerContextOptions = {},
): Promise<LedgerContext> {
  return (await createTenantRegistry(dbPath, options)).get(DEFAULT_TENANT);
}

async function openConfiguredAdapter(
  dbPath: string,
  options: CreateLedgerContextOptions,
): Promise<StorageAdapter> {
  const storage =
    options.storage ?? (process.env.ACT_STORAGE as 'sqlite' | 'postgres' | undefined) ?? 'sqlite';
  if (storage === 'postgres') {
    const connectionString = options.connectionString ?? process.env.ACT_DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        'ACT_STORAGE=postgres requires a connection string via ACT_DATABASE_URL or options.connectionString',
      );
    }
    return new PostgresAdapter(connectionString);
  }
  return SqliteAdapter.open(dbPath);
}
