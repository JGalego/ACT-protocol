/**
 * Lineage-typed causal-parent relations, per ACT-1.0.md section 6.3: only
 * these relations participate in cycle detection. `approval-of` and
 * `response-to` express accountability/attestation links, not lineage, and
 * are intentionally excluded.
 */
export const LINEAGE_RELATIONS: ReadonlySet<string> = new Set([
  'input',
  'output',
  'revision-of',
  'merge-of',
]);

/**
 * Detects whether adding `newEventId` with the given lineage-typed parent
 * edges would introduce a cycle into `existingEdges` (parent_event_id ->
 * children already accepted by the ledger). Returns the cycle path if one
 * would be introduced, otherwise null.
 *
 * `existingEdges` maps an event id to the ids of every event that names it
 * as a lineage-typed causal parent (i.e. its known children). For a single
 * ledger accepting events strictly one at a time, a cycle cannot actually
 * occur (an event's parents must already be accepted, hence already
 * fixed, before it can reference them) -- this check earns its keep once a
 * batch of not-yet-accepted events (e.g. a federation import bundle, or a
 * partial import that later gets backfilled) is validated together, where
 * `existingEdges` can already include tentative edges among that batch.
 */
export function detectCycle(
  existingEdges: ReadonlyMap<string, readonly string[]>,
  newEventId: string,
  newEventLineageParents: readonly string[],
): string[] | null {
  // A cycle exists iff, starting from newEventId and following the
  // (parent -> child) edges forward, we can reach one of newEventId's own
  // parents -- meaning newEventId is (transitively) both an ancestor and a
  // descendant of that parent.
  for (const parentId of newEventLineageParents) {
    const path = findPath(existingEdges, newEventId, parentId, new Set());
    if (path) return [newEventId, ...path];
  }
  return null;
}

function findPath(
  edges: ReadonlyMap<string, readonly string[]>,
  from: string,
  to: string,
  visited: Set<string>,
): string[] | null {
  if (from === to) return [to];
  if (visited.has(from)) return null;
  visited.add(from);
  const children = edges.get(from) ?? [];
  for (const child of children) {
    const rest = findPath(edges, child, to, visited);
    if (rest) return [child, ...rest];
  }
  return null;
}
