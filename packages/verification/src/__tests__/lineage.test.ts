import { describe, expect, it } from 'vitest';
import { checkLineageCompleteness } from '../lineage.js';
import type { LineageResult } from '@act/ledger';

describe('checkLineageCompleteness', () => {
  it('produces no findings for a complete, non-truncated lineage', () => {
    const lineage: LineageResult = {
      ancestors: [],
      descendants: [],
      boundaries: [],
      truncated: false,
    };
    expect(checkLineageCompleteness('event-1', lineage)).toEqual([]);
  });

  it('reports a missing-parent finding for each boundary', () => {
    const lineage: LineageResult = {
      ancestors: [],
      descendants: [],
      boundaries: [{ missingParentEventId: 'sha-256:abc', referencedBy: 'event-1' }],
      truncated: false,
    };
    const findings = checkLineageCompleteness('event-1', lineage);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.ruleId).toBe('lineage.missing-parent');
    expect(findings[0]!.resultKind).toBe('mechanical');
  });

  it('reports a truncation finding when the traversal hit its depth bound', () => {
    const lineage: LineageResult = {
      ancestors: [],
      descendants: [],
      boundaries: [],
      truncated: true,
    };
    const findings = checkLineageCompleteness('event-1', lineage);
    expect(findings.some((f) => f.ruleId === 'lineage.traversal-truncated')).toBe(true);
  });
});
