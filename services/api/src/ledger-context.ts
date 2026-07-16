import { generateKeyPair } from '@act/crypto';
import { Ledger, openSqliteStore, type TrustPolicy } from '@act/ledger';
import { generateId } from '@act/core';

export interface RegisteredKey {
  keyId: string;
  publicKey: string;
  ownerActorId: string;
  status: 'issued' | 'active' | 'rotated' | 'expired' | 'revoked' | 'compromised';
}

/**
 * The API's in-memory key/trust registry. Populated by POST /v1/keys once a
 * self-signed proof-of-possession check passes (see routes/keys.ts). This is
 * a deliberately simple Phase 1 trust model -- see docs/roadmap.md and
 * docs/adr/0006-api-authentication-and-trust-bootstrap.md for the
 * production-hardening path (organizational vetting, admin approval,
 * OIDC-backed identity).
 */
export class KeyRegistry implements TrustPolicy {
  private readonly keys = new Map<string, RegisteredKey>();

  register(key: RegisteredKey): void {
    this.keys.set(key.keyId, key);
  }

  unregister(keyId: string): void {
    this.keys.delete(keyId);
  }

  get(keyId: string): RegisteredKey | undefined {
    return this.keys.get(keyId);
  }

  isTrusted(_actorId: string, keyId: string): boolean {
    const key = this.keys.get(keyId);
    return key !== undefined && (key.status === 'issued' || key.status === 'active');
  }

  publicKeysByKeyId(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [keyId, key] of this.keys) out[keyId] = key.publicKey;
    return out;
  }
}

export interface LedgerContext {
  ledger: Ledger;
  keyRegistry: KeyRegistry;
  ledgerId: string;
  ledgerSigner: { keyId: string; publicKey: string; privateKey: string };
}

/** Builds a fully wired ledger context: a fresh signing key, an empty key registry, and a SQLite-backed ledger. */
export function createLedgerContext(dbPath: string): LedgerContext {
  const db = openSqliteStore(dbPath);
  const ledgerId = generateId();
  const signerKeyPair = generateKeyPair();
  const keyRegistry = new KeyRegistry();
  const ledgerSigner = {
    keyId: signerKeyPair.keyId,
    publicKey: signerKeyPair.publicKey,
    privateKey: signerKeyPair.privateKey,
  };
  const ledger = new Ledger({
    ledgerId,
    db,
    signer: ledgerSigner,
    trustPolicy: keyRegistry,
  });
  return { ledger, keyRegistry, ledgerId, ledgerSigner };
}
