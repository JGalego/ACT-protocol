import { LINEAGE_RELATIONS } from './cycle.js';
import type { StoredEvent } from './types.js';

/**
 * Event types whose payload carries a single decision over an exact,
 * immutable subject (artifact_id + version_id) plus the policy version it
 * was decided under. Extensible to other decision-bearing event types
 * (e.g. verification_recorded, challenge_resolved) following the same
 * shape; only approval_decided exists as a fixture-backed schema today.
 */
export const DECISION_BEARING_EVENT_TYPES: ReadonlySet<string> = new Set(['approval_decided']);

export interface CausalEdge {
  parentEventId: string;
  relation: string;
  childEventId: string;
  isMissing: boolean;
}

export interface ForkFinding {
  parentEventId: string;
  relation: string;
  childEventIds: string[];
}

export interface EquivocationFinding {
  actorId: string;
  keyId: string;
  subjectArtifactId: string;
  subjectVersionId: string;
  policyId: string;
  policyVersion: string;
  conflictingEventIds: string[];
  decisions: string[];
}

/**
 * spec/federation.md section 6: two or more accepted events naming the same
 * parent as sole predecessor over a lineage-typed relation. This is
 * informational -- legitimate branches (intent forks, competing proposals)
 * are expected and surfaced, not hidden or rejected.
 */
export function detectForks(edges: readonly CausalEdge[]): ForkFinding[] {
  const groups = new Map<string, string[]>();
  for (const e of edges) {
    if (e.isMissing || !LINEAGE_RELATIONS.has(e.relation)) continue;
    const key = `${e.parentEventId}::${e.relation}`;
    const list = groups.get(key) ?? [];
    list.push(e.childEventId);
    groups.set(key, list);
  }
  const findings: ForkFinding[] = [];
  for (const [key, childEventIds] of groups) {
    if (childEventIds.length <= 1) continue;
    const [parentEventId, relation] = key.split('::') as [string, string];
    findings.push({ parentEventId, relation, childEventIds });
  }
  return findings;
}

interface DecisionPayload {
  subject: { artifact_id: string; version_id: string };
  decision: string;
  policy_id: string;
  policy_version: string;
}

interface DecisionEnvelopePayload {
  actor: { actor_id: string; key_id: string };
  /** The ApprovalDecision artifact envelope; the decision itself is nested at payload.data.decision (schemas/artifact/types/approval-decision.schema.json). */
  payload: { data: { decision: DecisionPayload } };
}

function isDecisionPayload(d: unknown): d is DecisionPayload {
  if (typeof d !== 'object' || d === null) return false;
  const x = d as Partial<DecisionPayload>;
  return (
    typeof x.decision === 'string' &&
    typeof x.policy_id === 'string' &&
    typeof x.policy_version === 'string' &&
    typeof x.subject?.artifact_id === 'string' &&
    typeof x.subject?.version_id === 'string'
  );
}

/**
 * spec/federation.md section 6: the SAME actor/key signing conflicting
 * decisions over the identical (subject digest, policy version) tuple --
 * adversarial, distinct from a legitimate fork. Repeating the identical
 * decision is not equivocation (e.g. idempotent resubmission); only a
 * genuine conflict (differing `decision` values) is flagged.
 */
export function detectEquivocation(events: readonly StoredEvent[]): EquivocationFinding[] {
  const groups = new Map<string, { events: StoredEvent[]; decisions: string[] }>();
  for (const e of events) {
    if (!DECISION_BEARING_EVENT_TYPES.has(e.eventType)) continue;
    const payload = e.envelope.payload as unknown as DecisionEnvelopePayload;
    // A decision-typed event whose body is not a well-formed decision cannot
    // equivocate about anything; it must not abort the scan for everyone else.
    const d = payload?.payload?.data?.decision;
    if (!isDecisionPayload(d)) continue;
    const key = [
      payload.actor.key_id,
      d.subject.artifact_id,
      d.subject.version_id,
      d.policy_id,
      d.policy_version,
    ].join('::');
    const group = groups.get(key) ?? { events: [], decisions: [] };
    group.events.push(e);
    group.decisions.push(d.decision);
    groups.set(key, group);
  }

  const findings: EquivocationFinding[] = [];
  for (const group of groups.values()) {
    if (new Set(group.decisions).size <= 1) continue;
    const first = group.events[0]!;
    const firstPayload = first.envelope.payload as unknown as DecisionEnvelopePayload;
    const firstDecision = firstPayload.payload.data.decision;
    findings.push({
      actorId: firstPayload.actor.actor_id,
      keyId: firstPayload.actor.key_id,
      subjectArtifactId: firstDecision.subject.artifact_id,
      subjectVersionId: firstDecision.subject.version_id,
      policyId: firstDecision.policy_id,
      policyVersion: firstDecision.policy_version,
      conflictingEventIds: group.events.map((e) => e.eventId),
      decisions: group.decisions,
    });
  }
  return findings;
}
