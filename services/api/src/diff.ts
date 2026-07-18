/**
 * A minimal, dependency-free structural diff over plain JSON-shaped
 * values, for GET /v1/artifacts/:id/diff. Deliberately not a third-party
 * diff library: the comparison only needs to walk plain
 * object/array/scalar JSON, which is a small enough surface to keep
 * in-house (consistent with this repo's existing avoidance of
 * unnecessary dependencies for core logic, e.g. ADR 0002's hand-rolled
 * canonicalization).
 */

export type DiffChangeType = 'added' | 'removed' | 'changed';

export interface DiffEntry {
  path: string;
  type: DiffChangeType;
  before?: unknown;
  after?: unknown;
}

/** Diffs two plain JSON-shaped values, reporting every path whose value differs. */
export function diffValues(before: unknown, after: unknown, path = '$'): DiffEntry[] {
  if (deepEqual(before, after)) return [];

  const bothPlainObjects = isPlainObject(before) && isPlainObject(after);
  if (bothPlainObjects) {
    const beforeObj = before as Record<string, unknown>;
    const afterObj = after as Record<string, unknown>;
    const keys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);
    const entries: DiffEntry[] = [];
    for (const key of keys) {
      const childPath = `${path}.${key}`;
      if (!(key in beforeObj)) {
        entries.push({ path: childPath, type: 'added', after: afterObj[key] });
      } else if (!(key in afterObj)) {
        entries.push({ path: childPath, type: 'removed', before: beforeObj[key] });
      } else {
        entries.push(...diffValues(beforeObj[key], afterObj[key], childPath));
      }
    }
    return entries;
  }

  return [{ path, type: 'changed', before, after }];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => key in b && deepEqual(a[key], b[key]));
  }
  return false;
}
