import { detectEquivocation, detectForks, type StoredEvent } from '@act/ledger';
import type { CheckResult } from './types.js';

function decisionEvent(
  eventId: string,
  keyId: string,
  decision: string,
  overrides: Partial<{
    artifactId: string;
    versionId: string;
    policyId: string;
    policyVersion: string;
  }> = {},
): StoredEvent {
  const artifactId = overrides.artifactId ?? 'A';
  const versionId = overrides.versionId ?? 'V';
  const policyId = overrides.policyId ?? 'P';
  const policyVersion = overrides.policyVersion ?? 'PV';
  return {
    eventId,
    ledgerId: 'L',
    sequence: 0,
    eventType: 'approval_decided',
    subjectKind: 'attestation',
    subjectArtifactId: null,
    subjectVersionId: null,
    acceptedAt: '2026-01-01T00:00:00Z',
    envelope: {
      payload: {
        actor: { actor_id: 'reviewer-1', key_id: keyId },
        payload: {
          data: {
            decision: {
              subject: { artifact_id: artifactId, version_id: versionId },
              decision,
              policy_id: policyId,
              policy_version: policyVersion,
            },
          },
        },
      },
      payloadDigest: eventId,
      signatures: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  };
}

/** Federation profile: fork (informational) vs equivocation (adversarial) detection (spec/federation.md section 6). */
export function run(): CheckResult[] {
  const results: CheckResult[] = [];

  {
    const forks = detectForks([
      { parentEventId: 'p1', relation: 'input', childEventId: 'c1', isMissing: false },
      { parentEventId: 'p1', relation: 'input', childEventId: 'c2', isMissing: false },
    ]);
    const pass = forks.length === 1 && forks[0]!.childEventIds.length === 2;
    results.push({
      id: 'federation/fork-detected',
      category: 'federation',
      profile: 'federation',
      expected: '1 fork with 2 children',
      actual: JSON.stringify(forks),
      pass,
    });
  }

  {
    const equivocations = detectEquivocation([
      decisionEvent('e1', 'ed25519:aaaa', 'approved'),
      decisionEvent('e2', 'ed25519:aaaa', 'rejected'),
    ]);
    const pass = equivocations.length === 1 && equivocations[0]!.conflictingEventIds.length === 2;
    results.push({
      id: 'federation/equivocation-detected',
      category: 'federation',
      profile: 'federation',
      expected: '1 equivocation with 2 conflicting events',
      actual: JSON.stringify(equivocations),
      pass,
    });
  }

  {
    const equivocations = detectEquivocation([
      decisionEvent('e1', 'ed25519:aaaa', 'approved'),
      decisionEvent('e2', 'ed25519:aaaa', 'approved'),
    ]);
    const pass = equivocations.length === 0;
    results.push({
      id: 'federation/no-equivocation-on-repeated-identical-decision',
      category: 'federation',
      profile: 'federation',
      expected: '0 equivocations',
      actual: JSON.stringify(equivocations),
      pass,
    });
  }

  return results;
}
