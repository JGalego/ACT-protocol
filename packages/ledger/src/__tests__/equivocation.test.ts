import { describe, expect, it } from 'vitest';
import { detectEquivocation, detectForks } from '../equivocation.js';
import type { StoredEvent } from '../types.js';

function decisionEvent(params: {
  eventId: string;
  keyId: string;
  actorId?: string;
  artifactId: string;
  versionId: string;
  policyId: string;
  policyVersion: string;
  decision: string;
}): StoredEvent {
  return {
    eventId: params.eventId,
    ledgerId: 'L',
    sequence: 0,
    eventType: 'approval_decided',
    subjectKind: 'attestation',
    subjectArtifactId: null,
    subjectVersionId: null,
    acceptedAt: '2026-01-01T00:00:00Z',
    envelope: {
      payload: {
        actor: { actor_id: params.actorId ?? 'reviewer-1', key_id: params.keyId },
        payload: {
          data: {
            decision: {
              subject: { artifact_id: params.artifactId, version_id: params.versionId },
              decision: params.decision,
              policy_id: params.policyId,
              policy_version: params.policyVersion,
            },
          },
        },
      },
      payloadDigest: params.eventId,
      signatures: [],
    } as any,
  };
}

describe('detectForks', () => {
  it('flags two children of the same parent under a lineage relation as a fork', () => {
    const findings = detectForks([
      { parentEventId: 'p1', relation: 'input', childEventId: 'c1', isMissing: false },
      { parentEventId: 'p1', relation: 'input', childEventId: 'c2', isMissing: false },
    ]);
    expect(findings).toEqual([
      { parentEventId: 'p1', relation: 'input', childEventIds: ['c1', 'c2'] },
    ]);
  });

  it('does not flag a single child as a fork', () => {
    expect(
      detectForks([
        { parentEventId: 'p1', relation: 'input', childEventId: 'c1', isMissing: false },
      ]),
    ).toEqual([]);
  });

  it('ignores missing-parent edges and non-lineage relations', () => {
    const findings = detectForks([
      { parentEventId: 'p1', relation: 'input', childEventId: 'c1', isMissing: true },
      { parentEventId: 'p1', relation: 'input', childEventId: 'c2', isMissing: true },
      { parentEventId: 'p2', relation: 'approval-of', childEventId: 'c3', isMissing: false },
      { parentEventId: 'p2', relation: 'approval-of', childEventId: 'c4', isMissing: false },
    ]);
    expect(findings).toEqual([]);
  });
});

describe('detectEquivocation', () => {
  it('flags the same reviewer key issuing conflicting decisions over the identical subject+policy', () => {
    const events = [
      decisionEvent({
        eventId: 'e1',
        keyId: 'ed25519:aaaa',
        artifactId: 'A',
        versionId: 'V',
        policyId: 'P',
        policyVersion: 'PV',
        decision: 'approved',
      }),
      decisionEvent({
        eventId: 'e2',
        keyId: 'ed25519:aaaa',
        artifactId: 'A',
        versionId: 'V',
        policyId: 'P',
        policyVersion: 'PV',
        decision: 'rejected',
      }),
    ];
    const findings = detectEquivocation(events);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      keyId: 'ed25519:aaaa',
      subjectArtifactId: 'A',
      subjectVersionId: 'V',
      conflictingEventIds: ['e1', 'e2'],
      decisions: ['approved', 'rejected'],
    });
  });

  it('does not flag the identical decision repeated by the same key (idempotent resubmission)', () => {
    const events = [
      decisionEvent({
        eventId: 'e1',
        keyId: 'ed25519:aaaa',
        artifactId: 'A',
        versionId: 'V',
        policyId: 'P',
        policyVersion: 'PV',
        decision: 'approved',
      }),
      decisionEvent({
        eventId: 'e2',
        keyId: 'ed25519:aaaa',
        artifactId: 'A',
        versionId: 'V',
        policyId: 'P',
        policyVersion: 'PV',
        decision: 'approved',
      }),
    ];
    expect(detectEquivocation(events)).toEqual([]);
  });

  it('does not flag two different reviewers deciding differently (that is ordinary quorum disagreement, not equivocation)', () => {
    const events = [
      decisionEvent({
        eventId: 'e1',
        keyId: 'ed25519:aaaa',
        artifactId: 'A',
        versionId: 'V',
        policyId: 'P',
        policyVersion: 'PV',
        decision: 'approved',
      }),
      decisionEvent({
        eventId: 'e2',
        keyId: 'ed25519:bbbb',
        artifactId: 'A',
        versionId: 'V',
        policyId: 'P',
        policyVersion: 'PV',
        decision: 'rejected',
      }),
    ];
    expect(detectEquivocation(events)).toEqual([]);
  });

  it('ignores non-decision-bearing event types', () => {
    const events: StoredEvent[] = [
      {
        eventId: 'e1',
        ledgerId: 'L',
        sequence: 0,
        eventType: 'genesis',
        subjectKind: 'artifact',
        subjectArtifactId: 'A',
        subjectVersionId: 'V',
        acceptedAt: '2026-01-01T00:00:00Z',
        envelope: { payload: {}, payloadDigest: 'e1', signatures: [] } as any,
      },
    ];
    expect(detectEquivocation(events)).toEqual([]);
  });
});
