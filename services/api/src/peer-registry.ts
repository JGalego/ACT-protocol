import { generateId } from '@act/core';
import type { MetaStore } from './tenancy.js';

export interface PeerConfig {
  peerId: string;
  /** This peer's base URL, e.g. https://ledger.example.org -- no trailing slash. */
  url: string;
  label?: string;
  /** Sent as `Authorization: Bearer <token>` on outgoing calls to this peer. Never returned by the API. */
  bearerToken?: string;
  /**
   * The peer ledger's identity, pinned out of band by an operator. A bundle is
   * only accepted when it names this ledger and is signed by this key
   * (spec/federation.md section 3); the ledger never learns it from the peer.
   */
  ledgerId: string;
  ledgerKeyId: string;
  ledgerPublicKey: string;
}

export type PublicPeerConfig = Omit<PeerConfig, 'bearerToken'> & { hasBearerToken: boolean };

export function toPublicPeer(peer: PeerConfig): PublicPeerConfig {
  const { bearerToken, ...rest } = peer;
  return { ...rest, hasBearerToken: bearerToken !== undefined };
}

const PREFIX = 'peer:';

/**
 * Peer-ledger directory, persisted in the tenant's slice of the metadata store
 * so it survives restarts, is shared by every replica of one database, and is
 * invisible to every other tenant (ADR 0010).
 * Registering a peer is an explicit trust decision by an operator; pulled
 * events still go through the full write path, including trust-policy
 * evaluation against the key registry.
 */
export class PeerRegistry {
  constructor(private readonly adapter: MetaStore) {}

  async register(input: Omit<PeerConfig, 'peerId'>): Promise<PeerConfig> {
    const config: PeerConfig = { peerId: generateId(), ...input };
    await this.adapter.setMeta(`${PREFIX}${config.peerId}`, JSON.stringify(config));
    return config;
  }

  async list(): Promise<PeerConfig[]> {
    const rows = await this.adapter.listMeta(PREFIX);
    return rows.map((r) => JSON.parse(r.value) as PeerConfig);
  }

  async get(peerId: string): Promise<PeerConfig | undefined> {
    const raw = await this.adapter.getMeta(`${PREFIX}${peerId}`);
    return raw ? (JSON.parse(raw) as PeerConfig) : undefined;
  }

  async findByLedgerId(ledgerId: string): Promise<PeerConfig | undefined> {
    return (await this.list()).find((p) => p.ledgerId === ledgerId);
  }

  async remove(peerId: string): Promise<boolean> {
    return this.adapter.deleteMeta(`${PREFIX}${peerId}`);
  }
}
