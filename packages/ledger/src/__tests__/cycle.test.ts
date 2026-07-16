import { describe, expect, it } from 'vitest';
import { detectCycle } from '../cycle.js';

describe('detectCycle', () => {
  it('returns null for a simple acyclic append', () => {
    const edges = new Map<string, string[]>([['A', ['B']]]);
    expect(detectCycle(edges, 'C', ['B'])).toBeNull();
  });

  it('detects a direct cycle: the claimed parent is already reachable forward from the new event', () => {
    // Existing (batch) graph: newEvent -> B -> A. If newEvent now also claims
    // A as one of its own causal parents, A would be both an ancestor and a
    // descendant of newEvent -- a cycle.
    const edges = new Map<string, string[]>([
      ['newEvent', ['B']],
      ['B', ['A']],
    ]);
    const cycle = detectCycle(edges, 'newEvent', ['A']);
    expect(cycle).not.toBeNull();
    expect(cycle![0]).toBe('newEvent');
    expect(cycle![cycle!.length - 1]).toBe('A');
  });

  it('detects a self-loop', () => {
    const edges = new Map<string, string[]>();
    expect(detectCycle(edges, 'A', ['A'])).toEqual(['A', 'A']);
  });

  it('ignores unrelated branches', () => {
    const edges = new Map<string, string[]>([
      ['A', ['B', 'C']],
      ['B', ['D']],
    ]);
    expect(detectCycle(edges, 'E', ['D'])).toBeNull();
  });

  it('terminates instead of looping forever when the existing graph itself contains an unrelated cycle', () => {
    // newEvent -> X -> Y -> X (a pre-existing cycle among X/Y, unrelated to
    // the target). Without the visited-node cutoff, searching for an
    // unreachable target would recurse forever between X and Y.
    const edges = new Map<string, string[]>([
      ['newEvent', ['X']],
      ['X', ['Y']],
      ['Y', ['X']],
    ]);
    expect(detectCycle(edges, 'newEvent', ['unreachable-target'])).toBeNull();
  });
});
