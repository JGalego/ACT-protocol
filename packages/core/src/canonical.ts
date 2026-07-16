/**
 * Serializes a value to RFC 8785 (JSON Canonicalization Scheme, JCS) bytes.
 * Throws if the value contains a type JCS cannot represent unambiguously
 * (e.g. undefined, function, bigint, or a non-finite number), per
 * ACT-1.0.md section 4.1.
 *
 * This does not depend on a third-party canonicalizer: for the strict JSON
 * data model (object/array/string/number/boolean/null), RFC 8785 reduces to
 * (a) recursively sorting object keys by UTF-16 code unit and (b) using
 * ECMAScript's own JSON.stringify for every leaf value and every key, which
 * already implements JCS-compatible number formatting (ECMA-262
 * Number::toString) and string escaping.
 */
export function canonicalize(value: unknown): string {
  assertCanonicalizable(value);
  return serialize(value);
}

export function canonicalizeToBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalize(value));
}

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalizationError';
  }
}

function serialize(value: unknown): string {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => serialize(item === undefined ? null : item)).join(',')}]`;
  }
  // typeof value === 'object' (non-null, non-array) at this point.
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  const members = keys.map((key) => `${JSON.stringify(key)}:${serialize(record[key])}`);
  return `{${members.join(',')}}`;
}

function assertCanonicalizable(value: unknown, path = '$'): void {
  if (value === undefined) {
    throw new CanonicalizationError(
      `Undefined value at ${path} is not representable in canonical JSON`,
    );
  }
  if (typeof value === 'function' || typeof value === 'symbol') {
    throw new CanonicalizationError(`Non-serializable ${typeof value} at ${path}`);
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new CanonicalizationError(
      `Non-finite number at ${path} is not representable in canonical JSON`,
    );
  }
  if (typeof value === 'bigint') {
    throw new CanonicalizationError(`BigInt at ${path} is not representable in canonical JSON`);
  }
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertCanonicalizable(item, `${path}[${index}]`));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined) continue; // JSON.stringify drops undefined object values; JCS does too.
      assertCanonicalizable(item, `${path}.${key}`);
    }
    return;
  }
}
