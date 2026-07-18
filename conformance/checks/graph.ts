import { detectCycle } from '@act/ledger';
import type { CheckResult } from './types.js';

/** Core profile: acyclic-lineage enforcement (spec/conformance.md section 1, ACT-1.0.md section 6.3). */
export function run(): CheckResult[] {
  const results: CheckResult[] = [];

  // Valid DAG: a two-input transformation, no cycle.
  {
    const edges = new Map<string, string[]>([
      ['a', ['c']],
      ['b', ['c']],
    ]);
    const cycle = detectCycle(edges, 'c', ['a', 'b']);
    results.push({
      id: 'graph/two-input-transformation-no-cycle',
      category: 'graph',
      profile: 'core',
      expected: 'null',
      actual: JSON.stringify(cycle),
      pass: cycle === null,
    });
  }

  // Merge: two branches merging into one node, no cycle.
  {
    const edges = new Map<string, string[]>([['root', ['branchA', 'branchB']]]);
    const cycle = detectCycle(edges, 'merge', ['branchA', 'branchB']);
    results.push({
      id: 'graph/merge-two-branches-no-cycle',
      category: 'graph',
      profile: 'core',
      expected: 'null',
      actual: JSON.stringify(cycle),
      pass: cycle === null,
    });
  }

  // Cycle: a batch (e.g. a federation import) where an already-accepted
  // event ("x") already forward-cites the about-to-be-appended event ("y")
  // as ITS parent, and "y" in turn declares "x" as its own parent --
  // exactly the shape cycle.ts's own unit test constructs. Must be rejected.
  {
    const edges = new Map<string, string[]>([['y', ['x']]]);
    const cycle = detectCycle(edges, 'y', ['x']);
    const pass = cycle !== null;
    results.push({
      id: 'graph/batch-cycle-rejected',
      category: 'graph',
      profile: 'core',
      expected: 'non-null (cycle detected)',
      actual: JSON.stringify(cycle),
      pass,
    });
  }

  return results;
}
