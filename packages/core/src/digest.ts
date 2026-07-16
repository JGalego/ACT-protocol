import { createHash } from 'node:crypto';
import { canonicalize } from './canonical.js';

export type DigestAlgorithm = 'sha-256';

const NODE_HASH_NAME: Record<DigestAlgorithm, string> = {
  'sha-256': 'sha256',
};

const DIGEST_PATTERN = /^(sha-256):([0-9a-f]{64})$/;

/** Computes an ACT digest string ("algorithm:hex") over raw bytes. */
export function digestBytes(
  bytes: Uint8Array | string,
  algorithm: DigestAlgorithm = 'sha-256',
): string {
  const hash = createHash(NODE_HASH_NAME[algorithm]).update(bytes).digest('hex');
  return `${algorithm}:${hash}`;
}

/** Computes an ACT digest over the RFC 8785 canonical bytes of a JSON value. */
export function digestCanonicalValue(
  value: unknown,
  algorithm: DigestAlgorithm = 'sha-256',
): string {
  return digestBytes(canonicalize(value), algorithm);
}

export interface ParsedDigest {
  algorithm: DigestAlgorithm;
  hex: string;
}

/** Parses and validates the "algorithm:hex" digest form. Throws on malformed or unregistered-algorithm input. */
export function parseDigest(digest: string): ParsedDigest {
  const match = DIGEST_PATTERN.exec(digest);
  if (!match) {
    throw new InvalidDigestError(digest);
  }
  return { algorithm: match[1] as DigestAlgorithm, hex: match[2] as string };
}

export function isValidDigestForm(digest: string): boolean {
  return DIGEST_PATTERN.test(digest);
}

/** Recomputes a digest over canonical bytes and compares to the claimed value in constant-ish time via string equality post-hash. */
export function verifyDigest(value: unknown, claimedDigest: string): boolean {
  const { algorithm } = parseDigest(claimedDigest);
  return digestCanonicalValue(value, algorithm) === claimedDigest;
}

export class InvalidDigestError extends Error {
  constructor(digest: string) {
    super(`Invalid or unregistered digest: ${JSON.stringify(digest)}`);
    this.name = 'InvalidDigestError';
  }
}
