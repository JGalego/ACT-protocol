import { generateKeyPair, keyPairFromPrivateKey } from '@act/crypto';
import { Ledger, SqliteAdapter, PostgresAdapter, type StorageAdapter } from '@act/ledger';
import { generateId } from '@act/core';
import type { AuthorityPolicyDocument } from '@act/policy';
import { PeerRegistry } from './peer-registry.js';
import { KeyRegistry } from './key-registry.js';

export { KeyRegistry } from './key-registry.js';

export interface AuthorityConfig {
  policy: AuthorityPolicyDocument;
  /** actor_id -> roles held. The operator-asserted source of roles for authority evaluation. */
  actorRoles: Record<string, string[]>;
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

export interface LedgerContext {
  ledger: Ledger;
  adapter: StorageAdapter;
  keyRegistry: KeyRegistry;
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
  /** Base64 Ed25519 seed for the ledger's signing key; defaults to process.env.ACT_LEDGER_PRIVATE_KEY. */
  ledgerPrivateKey?: string;
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
  adapter: StorageAdapter,
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

/** Builds a fully wired ledger context over a migrated storage adapter, with the key registry replayed from the event log. */
export async function createLedgerContext(
  dbPath: string,
  options: CreateLedgerContextOptions = {},
): Promise<LedgerContext> {
  const adapter = options.adapter ?? (await openConfiguredAdapter(dbPath, options));
  await adapter.migrate();

  const { ledgerId, signer: ledgerSigner } = await loadOrCreateIdentity(
    adapter,
    options.ledgerPrivateKey ?? process.env.ACT_LEDGER_PRIVATE_KEY,
  );
  const keyRegistry = new KeyRegistry();
  const peerRegistry = new PeerRegistry(adapter);
  const ledger = new Ledger({
    ledgerId,
    adapter,
    signer: ledgerSigner,
    trustPolicy: keyRegistry,
  });
  await keyRegistry.catchUp(ledger);
  return {
    ledger,
    adapter,
    keyRegistry,
    peerRegistry,
    ledgerId,
    ledgerSigner,
    // Restrictive until `buildServer` applies the operator's configuration.
    policy: { devMode: false, keyRegistration: 'admin', allowPrivatePeers: false },
  };
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
