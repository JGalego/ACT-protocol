import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { badRequest } from './problem.js';

/** Whether an IP literal is loopback, private, link-local, or otherwise not a public unicast address. */
export function isNonPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b] = address.split('.').map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isNonPublicAddress(mapped[1]!);
    return /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith('ff');
  }
  return false;
}

/** Syntactic check done at registration time. Returns the normalized base URL (no trailing slash). */
export function assertPeerUrlAcceptable(raw: string, allowPrivate: boolean): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw badRequest('invalid_peer_url', 'Peer url is not a valid absolute URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw badRequest('invalid_peer_url', 'Peer url must use http or https');
  }
  if (url.username || url.password) {
    throw badRequest('invalid_peer_url', 'Peer url must not embed credentials');
  }
  if (!allowPrivate) {
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || isNonPublicAddress(host)) {
      throw badRequest(
        'invalid_peer_url',
        'Peer url resolves to a loopback, private, or link-local address',
      );
    }
  }
  return url.toString().replace(/\/$/, '');
}

/**
 * Resolution check done immediately before each outbound call. A DNS name can
 * be registered while public and rebound later, so the syntactic check alone
 * is not enough. (A residual race between this lookup and the connection
 * remains; network egress policy is the complete answer, see docs/deployment.md.)
 */
export async function assertResolvesPublic(rawUrl: string, allowPrivate: boolean): Promise<void> {
  if (allowPrivate) return;
  const host = new URL(rawUrl).hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.some((a) => isNonPublicAddress(a.address))) {
    throw badRequest('invalid_peer_url', 'Peer host resolves to a non-public address');
  }
}
