import { generateId } from '@act/core';

export interface PeerConfig {
  peerId: string;
  /** This peer's base URL, e.g. http://127.0.0.1:4001 -- no trailing slash. */
  url: string;
  label?: string;
  /** Sent as `Authorization: Bearer <token>` on outgoing calls to this peer. */
  bearerToken?: string;
}

/**
 * In-memory peer-ledger directory (Phase 1 scope, matching ledger-context.ts's
 * KeyRegistry precedent -- see ADR 0006 for the trust-model maturity level
 * this repository targets). Registering a peer does not itself grant it any
 * trust: pulled events still go through the full appendEvent write path,
 * including trust-policy evaluation against ctx.keyRegistry.
 */
export class PeerRegistry {
  private readonly peers = new Map<string, PeerConfig>();

  register(input: Omit<PeerConfig, 'peerId'>): PeerConfig {
    const peerId = generateId();
    const config: PeerConfig = { peerId, ...input };
    this.peers.set(peerId, config);
    return config;
  }

  list(): PeerConfig[] {
    return [...this.peers.values()];
  }

  get(peerId: string): PeerConfig | undefined {
    return this.peers.get(peerId);
  }

  remove(peerId: string): boolean {
    return this.peers.delete(peerId);
  }
}
