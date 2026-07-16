import type { LineageResult } from '@act/ledger';
import { finding, type Finding } from './findings.js';

/**
 * Converts a ledger lineage traversal into explained findings: an explicit
 * missing-parent boundary is reported (never silently treated as complete
 * lineage, ACT-1.0.md section 5.4), and a traversal that hit the depth
 * bound is flagged as potentially incomplete rather than presented as
 * exhaustive.
 */
export function checkLineageCompleteness(eventId: string, lineage: LineageResult): Finding[] {
  const findings: Finding[] = [];

  for (const boundary of lineage.boundaries) {
    findings.push(
      finding({
        ruleId: 'lineage.missing-parent',
        severity: 'medium',
        resultKind: 'mechanical',
        affectedRecords: [boundary.referencedBy],
        evidence: [boundary.missingParentEventId],
        explanation: `Event ${boundary.referencedBy} names ${boundary.missingParentEventId} as a causal parent, but that event is not present in this ledger. This lineage is a partial-history import boundary, not a complete history.`,
        remediation:
          'Import the missing event from its origin ledger if available, or accept this as a documented provenance boundary (e.g. an External Import).',
      }),
    );
  }

  if (lineage.truncated) {
    findings.push(
      finding({
        ruleId: 'lineage.traversal-truncated',
        severity: 'info',
        resultKind: 'mechanical',
        affectedRecords: [eventId],
        evidence: [],
        explanation:
          'The lineage traversal reached its bounded-depth limit before exhausting all ancestors or descendants.',
        remediation:
          'Re-run with a higher maxDepth if a complete traversal is required for this decision.',
      }),
    );
  }

  return findings;
}
