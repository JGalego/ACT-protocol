import type {
  ActorSummary,
  EventKind,
  EventStatus,
  ExplorerEvent,
  ExplorerScenario,
} from '../types';

const actors: Record<string, ActorSummary> = {
  maya: {
    id: 'actor:maya-chen',
    name: 'Maya Chen',
    role: 'Product owner',
    type: 'human',
  },
  planner: {
    id: 'actor:planner-ai',
    name: 'Planner AI',
    role: 'Proposal author',
    type: 'ai',
  },
  builder: {
    id: 'actor:builder-ai',
    name: 'Builder AI',
    role: 'Implementation agent',
    type: 'ai',
  },
  verifier: {
    id: 'actor:semantic-verifier',
    name: 'Independent verifier',
    role: 'Semantic assurance',
    type: 'service',
  },
  release: {
    id: 'actor:release-service',
    name: 'Release service',
    role: 'Runtime observer',
    type: 'service',
  },
};

function digest(character: string): string {
  return `sha-256:${character.repeat(64).slice(0, 64)}`;
}

interface EventInput {
  id: string;
  eventType: string;
  kind: EventKind;
  status: EventStatus;
  title: string;
  summary: string;
  timestamp: string;
  actor: ActorSummary;
  parents?: Array<{ id: string; relation: string }>;
  position: { x: number; y: number };
  digestCharacter: string;
  semanticChange: string;
  rationale: string;
  assumptions?: string[];
  uncertainties?: string[];
  evidence?: ExplorerEvent['evidence'];
  confidence: ExplorerEvent['confidence'];
  payload: Record<string, unknown>;
}

function event(sequence: number, input: EventInput): ExplorerEvent {
  return {
    sequence,
    parents: [],
    assumptions: [],
    uncertainties: [],
    evidence: [],
    signatureStatus: 'demonstration',
    ...input,
    digest: digest(input.digestCharacter),
  };
}

const events: ExplorerEvent[] = [
  event(1, {
    id: 'intent-support',
    eventType: 'artifact_created',
    kind: 'intent',
    status: 'recorded',
    title: 'Reduce support response time',
    summary: 'Help agents answer faster without retaining customer messages after resolution.',
    timestamp: '09:00:00',
    actor: actors.maya!,
    position: { x: 100, y: 210 },
    digestCharacter: '1',
    semanticChange: 'Root intent',
    rationale: 'Customer support needs faster triage without expanding data retention.',
    uncertainties: ['Target response-time reduction is not yet quantified.'],
    confidence: { semantic: 96, implementation: 12, verification: 8 },
    payload: {
      artifact_type: 'intent',
      statement:
        'Reduce support response time without retaining customer messages after resolution.',
      scope: 'Support triage and reply drafting',
    },
  }),
  event(2, {
    id: 'proposal-ai-triage',
    eventType: 'artifact_created',
    kind: 'proposal',
    status: 'proposed',
    title: 'AI-assisted triage',
    summary: 'Classify incoming messages and draft a response for a human support agent.',
    timestamp: '09:01:14',
    actor: actors.planner!,
    parents: [{ id: 'intent-support', relation: 'derived-from' }],
    position: { x: 300, y: 120 },
    digestCharacter: '2',
    semanticChange: 'Alternative proposal',
    rationale: 'Draft assistance shortens handling time while retaining human review.',
    assumptions: ['The organization may process messages with an approved AI service.'],
    uncertainties: ['Model accuracy across supported languages is unknown.'],
    evidence: [
      {
        id: 'evidence-benchmark',
        label: 'Triage benchmark',
        type: 'evaluation',
        status: 'recorded',
        detail: '82% category accuracy on a redacted historical sample.',
      },
    ],
    confidence: { semantic: 91, implementation: 28, verification: 22 },
    payload: {
      artifact_type: 'ai-proposal',
      objective: 'Classify support messages and draft replies for human review.',
      proposer: actors.planner!.id,
    },
  }),
  event(3, {
    id: 'transformation-requirements',
    eventType: 'transformation_recorded',
    kind: 'transformation',
    status: 'recorded',
    title: 'Proposal to requirements',
    summary: 'The proposal becomes an implementable requirement set with a 30-day message cache.',
    timestamp: '09:02:03',
    actor: actors.planner!,
    parents: [
      { id: 'intent-support', relation: 'input' },
      { id: 'proposal-ai-triage', relation: 'input' },
    ],
    position: { x: 510, y: 120 },
    digestCharacter: '3',
    semanticChange: 'Constraint refinement',
    rationale: 'A temporary cache was introduced to support evaluation and retry handling.',
    assumptions: ['Messages may be retained for 30 days for quality evaluation.'],
    uncertainties: ['The retention assumption has not been reconciled with the root intent.'],
    evidence: [
      {
        id: 'evidence-requirement-diff',
        label: 'Intent-to-requirement diff',
        type: 'semantic-diff',
        status: 'recorded',
        detail: 'One new retention assumption introduced.',
      },
    ],
    confidence: { semantic: 76, implementation: 48, verification: 31 },
    payload: {
      transformation_id: digest('3'),
      mode: 'discovery',
      inputs: ['intent-support', 'proposal-ai-triage'],
      outputs: ['requirement-triage-v1'],
      retention_days: 30,
    },
  }),
  event(4, {
    id: 'approval-v1',
    eventType: 'approval_decided',
    kind: 'approval',
    status: 'approved',
    title: 'Implementation authorized',
    summary: 'The product owner approves the requirement digest for a limited internal pilot.',
    timestamp: '09:04:38',
    actor: actors.maya!,
    parents: [{ id: 'transformation-requirements', relation: 'authorizes' }],
    position: { x: 720, y: 120 },
    digestCharacter: '4',
    semanticChange: 'No content change',
    rationale: 'The pilot is authorized for 50 internal support cases.',
    assumptions: ['Approval is scoped to an internal pilot and expires in seven days.'],
    uncertainties: ['The retention clause was not highlighted in the approval summary.'],
    evidence: [
      {
        id: 'evidence-signoff',
        label: 'Signed approval',
        type: 'authorization',
        status: 'verified',
        detail: 'Scope: internal pilot; subject: exact requirement digest.',
      },
    ],
    confidence: { semantic: 78, implementation: 54, verification: 36 },
    payload: {
      artifact_type: 'approval-decision',
      decision: 'approved',
      scope: 'Internal pilot, 50 cases',
      expires_at: '2026-07-24T09:04:38Z',
    },
  }),
  event(5, {
    id: 'implementation-v1',
    eventType: 'artifact_created',
    kind: 'implementation',
    status: 'recorded',
    title: 'Triage service v1',
    summary:
      'The agent implements classification, draft generation, and the approved 30-day cache.',
    timestamp: '09:08:17',
    actor: actors.builder!,
    parents: [
      { id: 'transformation-requirements', relation: 'implements' },
      { id: 'approval-v1', relation: 'authorized-by' },
    ],
    position: { x: 930, y: 120 },
    digestCharacter: '5',
    semanticChange: 'Exact implementation claim',
    rationale: 'The implementation follows requirement version 1 without reinterpretation.',
    assumptions: ['The approved retention configuration is policy compliant.'],
    uncertainties: ['Semantic fidelity to the root intent has not been independently checked.'],
    evidence: [
      {
        id: 'evidence-commit',
        label: 'Source commit',
        type: 'source-code',
        status: 'verified',
        detail: 'Commit and build output are content-addressed.',
      },
    ],
    confidence: { semantic: 78, implementation: 88, verification: 48 },
    payload: {
      artifact_type: 'source-code',
      repository: 'support/triage-service',
      revision: '8d6c2ab',
      retention_days: 30,
    },
  }),
  event(6, {
    id: 'test-v1',
    eventType: 'verification_recorded',
    kind: 'test',
    status: 'passed',
    title: 'Behavior suite passes',
    summary: 'Classification, authorization, deletion scheduling, and API contract tests all pass.',
    timestamp: '09:10:09',
    actor: actors.builder!,
    parents: [{ id: 'implementation-v1', relation: 'verifies' }],
    position: { x: 1140, y: 120 },
    digestCharacter: '6',
    semanticChange: 'No content change',
    rationale: 'Behavior matches the approved requirement set.',
    assumptions: ['Passing requirement tests imply readiness for semantic verification.'],
    uncertainties: ['Tests validate the approved requirements, not the originating intent.'],
    evidence: [
      {
        id: 'evidence-tests',
        label: '184 automated checks',
        type: 'test-report',
        status: 'verified',
        detail: '184 passed, 0 failed; branch coverage 93%.',
      },
    ],
    confidence: { semantic: 78, implementation: 94, verification: 86 },
    payload: {
      artifact_type: 'test',
      result: 'pass',
      checks: 184,
      coverage: 93,
    },
  }),
  event(7, {
    id: 'semantic-verification',
    eventType: 'verification_recorded',
    kind: 'verification',
    status: 'challenged',
    title: 'Intent drift detected',
    summary: 'Independent verification finds that 30-day retention conflicts with the root intent.',
    timestamp: '09:11:42',
    actor: actors.verifier!,
    parents: [
      { id: 'intent-support', relation: 'baseline' },
      { id: 'test-v1', relation: 'candidate' },
    ],
    position: { x: 1140, y: 330 },
    digestCharacter: '7',
    semanticChange: 'Semantic modification disputed',
    rationale: 'Behavioral correctness does not establish fidelity to the approved root intent.',
    assumptions: [],
    uncertainties: ['Whether any post-resolution retention is acceptable requires human judgment.'],
    evidence: [
      {
        id: 'evidence-drift',
        label: 'Semantic baseline comparison',
        type: 'verification-report',
        status: 'open',
        detail: 'Candidate retains content after resolution; baseline explicitly forbids it.',
      },
    ],
    confidence: { semantic: 52, implementation: 94, verification: 91 },
    payload: {
      artifact_type: 'verification-report',
      result: 'fail',
      method: 'baseline-comparison',
      finding: 'Retention contradicts root intent',
    },
  }),
  event(8, {
    id: 'challenge-retention',
    eventType: 'challenge_created',
    kind: 'challenge',
    status: 'challenged',
    title: 'Release challenged',
    summary:
      'Maya blocks release and requests an ephemeral design that preserves the original constraint.',
    timestamp: '09:13:05',
    actor: actors.maya!,
    parents: [
      { id: 'semantic-verification', relation: 'supported-by' },
      { id: 'approval-v1', relation: 'challenges' },
    ],
    position: { x: 930, y: 330 },
    digestCharacter: '8',
    semanticChange: 'Intent challenge',
    rationale:
      'Approval authorized implementation but did not erase the unresolved intent conflict.',
    assumptions: ['The pilot must not proceed while the challenge is open.'],
    uncertainties: ['Ephemeral evaluation quality must be re-measured.'],
    evidence: [
      {
        id: 'evidence-challenge',
        label: 'Signed challenge',
        type: 'challenge',
        status: 'open',
        detail: 'Release blocked pending requirement revision and reapproval.',
      },
    ],
    confidence: { semantic: 58, implementation: 94, verification: 92 },
    payload: {
      artifact_type: 'challenge',
      severity: 'blocking',
      status: 'open',
      requested_resolution: 'Remove post-resolution retention.',
    },
  }),
  event(9, {
    id: 'revision-ephemeral',
    eventType: 'artifact_revised',
    kind: 'revision',
    status: 'resolved',
    title: 'Ephemeral processing revision',
    summary:
      'Messages are processed in memory and deleted immediately when the support case resolves.',
    timestamp: '09:18:26',
    actor: actors.builder!,
    parents: [
      { id: 'challenge-retention', relation: 'resolves' },
      { id: 'implementation-v1', relation: 'revises' },
    ],
    position: { x: 720, y: 330 },
    digestCharacter: '9',
    semanticChange: 'Constraint restoration',
    rationale: 'The implementation is revised to match the explicit no-retention constraint.',
    assumptions: ['Aggregate quality metrics contain no message content.'],
    uncertainties: ['Quality evaluation now relies on consented, separately governed samples.'],
    evidence: [
      {
        id: 'evidence-deletion',
        label: 'Deletion boundary test',
        type: 'test-report',
        status: 'verified',
        detail: 'No message content remains after case resolution.',
      },
      {
        id: 'evidence-diff-v2',
        label: 'Intent comparison v2',
        type: 'semantic-diff',
        status: 'verified',
        detail: 'Retention conflict removed; no new semantic modifications found.',
      },
    ],
    confidence: { semantic: 95, implementation: 91, verification: 94 },
    payload: {
      artifact_type: 'revision',
      revises: 'implementation-v1',
      retention_days: 0,
      deletion_trigger: 'case_resolved',
    },
  }),
  event(10, {
    id: 'release-observation',
    eventType: 'runtime_observation_recorded',
    kind: 'observation',
    status: 'observed',
    title: 'Pilot outcome recorded',
    summary:
      'Median first response improves by 38%; retention monitors report no residual content.',
    timestamp: '16:30:00',
    actor: actors.release!,
    parents: [{ id: 'revision-ephemeral', relation: 'observes' }],
    position: { x: 510, y: 330 },
    digestCharacter: 'a',
    semanticChange: 'Observed outcome',
    rationale: 'Runtime evidence closes the loop between intent and measured outcome.',
    assumptions: ['Pilot traffic is representative of ordinary support volume.'],
    uncertainties: ['Long-term multilingual performance still requires monitoring.'],
    evidence: [
      {
        id: 'evidence-latency',
        label: 'Response-time telemetry',
        type: 'runtime-observation',
        status: 'verified',
        detail: 'Median first response: 14m to 8m, a 38% reduction.',
      },
      {
        id: 'evidence-retention-monitor',
        label: 'Retention monitor',
        type: 'runtime-observation',
        status: 'verified',
        detail: '0 residual message payloads across 50 completed cases.',
      },
    ],
    confidence: { semantic: 96, implementation: 93, verification: 96 },
    payload: {
      artifact_type: 'runtime-observation',
      response_time_improvement_percent: 38,
      residual_payloads: 0,
      cases_observed: 50,
    },
  }),
];

export const demoScenario: ExplorerScenario = {
  id: 'support-intent-drift',
  name: 'Support triage with an intent challenge',
  description: 'A complete accountable transformation, including a drift finding and resolution.',
  source: 'demonstration',
  sourceDetail: 'Deterministic demonstration ledger; identities and digests are non-production.',
  events,
  stages: [
    {
      id: 'intent',
      label: 'Intent',
      eyebrow: 'Human intent recorded',
      title: 'The constraint begins with the intent',
      description:
        'Maya records both the desired outcome and a hard privacy boundary. ACT preserves this as an immutable baseline instead of relying on memory.',
      focusEventId: 'intent-support',
      visibleThrough: 1,
      callout: {
        tone: 'neutral',
        label: 'Baseline',
        text: 'No customer messages retained after resolution.',
      },
      metrics: { records: 1, signatures: 1, approvals: 0, semanticConfidence: 96, drift: 0 },
    },
    {
      id: 'proposal',
      label: 'Proposal',
      eyebrow: 'AI proposal attributed',
      title: 'An AI proposes a path, not a decision',
      description:
        'The planner suggests assisted triage and drafts. Its assumptions and benchmark evidence remain attached to the proposal.',
      focusEventId: 'proposal-ai-triage',
      visibleThrough: 2,
      callout: {
        tone: 'positive',
        label: 'Provenance',
        text: 'The proposal names its AI author, input intent, evidence, and uncertainty.',
      },
      metrics: { records: 2, signatures: 2, approvals: 0, semanticConfidence: 91, drift: 4 },
    },
    {
      id: 'transform',
      label: 'Transform',
      eyebrow: 'Meaning transformed',
      title: 'A hidden assumption enters the chain',
      description:
        'Turning the proposal into requirements introduces a 30-day cache. ACT records the assumption even though its conflict has not yet been recognized.',
      focusEventId: 'transformation-requirements',
      visibleThrough: 3,
      callout: {
        tone: 'warning',
        label: 'New assumption',
        text: '30-day message retention was not present in the human intent.',
      },
      metrics: { records: 3, signatures: 3, approvals: 0, semanticConfidence: 76, drift: 18 },
    },
    {
      id: 'approve',
      label: 'Approve',
      eyebrow: 'Scoped authorization',
      title: 'Approval authorizes an exact version',
      description:
        'Maya signs a limited pilot approval against the requirement digest. The approval is attributable, scoped, and expiring; it does not erase other obligations.',
      focusEventId: 'approval-v1',
      visibleThrough: 4,
      callout: {
        tone: 'neutral',
        label: 'Approval scope',
        text: 'Internal pilot, 50 cases, seven-day expiry.',
      },
      metrics: { records: 4, signatures: 4, approvals: 1, semanticConfidence: 78, drift: 18 },
    },
    {
      id: 'implement',
      label: 'Build',
      eyebrow: 'Implementation linked',
      title: 'Code traces to inputs and authority',
      description:
        'The builder implements the approved requirements exactly. Both the requirement and authorization appear as typed lineage edges.',
      focusEventId: 'implementation-v1',
      visibleThrough: 5,
      callout: {
        tone: 'positive',
        label: 'Traceable build',
        text: 'Source revision 8d6c2ab links to its requirement and approval.',
      },
      metrics: { records: 5, signatures: 5, approvals: 1, semanticConfidence: 78, drift: 18 },
    },
    {
      id: 'test',
      label: 'Test',
      eyebrow: 'Behavior verified',
      title: 'Passing tests are necessary, not sufficient',
      description:
        'Every implementation test passes. The report proves conformance to the requirements, but it makes no claim that those requirements preserve the root intent.',
      focusEventId: 'test-v1',
      visibleThrough: 6,
      callout: {
        tone: 'positive',
        label: '184 / 184',
        text: 'Behavior checks pass with 93% branch coverage.',
      },
      metrics: { records: 6, signatures: 6, approvals: 1, semanticConfidence: 78, drift: 18 },
    },
    {
      id: 'verify',
      label: 'Verify',
      eyebrow: 'Semantic verification',
      title: 'The baseline exposes intent drift',
      description:
        'An independent verifier compares the implementation chain with the root intent. Technical confidence remains high while semantic confidence falls sharply.',
      focusEventId: 'semantic-verification',
      visibleThrough: 7,
      callout: {
        tone: 'critical',
        label: 'Drift detected',
        text: 'Thirty-day retention contradicts the no-retention baseline.',
      },
      metrics: { records: 7, signatures: 7, approvals: 1, semanticConfidence: 52, drift: 31 },
    },
    {
      id: 'challenge',
      label: 'Challenge',
      eyebrow: 'Human challenge opened',
      title: 'A challenge blocks release without rewriting history',
      description:
        'Maya challenges the approved version. The approval remains part of history, while policy prevents the disputed release from proceeding.',
      focusEventId: 'challenge-retention',
      visibleThrough: 8,
      callout: {
        tone: 'critical',
        label: 'Release blocked',
        text: 'Resolve retention drift and obtain a new authorization.',
      },
      metrics: { records: 8, signatures: 8, approvals: 1, semanticConfidence: 58, drift: 31 },
    },
    {
      id: 'revise',
      label: 'Revise',
      eyebrow: 'Constraint restored',
      title: 'The chain records its correction',
      description:
        'The implementation is revised to use ephemeral processing. New evidence proves deletion at case resolution and the semantic comparison passes.',
      focusEventId: 'revision-ephemeral',
      visibleThrough: 9,
      callout: {
        tone: 'positive',
        label: 'Challenge resolved',
        text: 'The revision restores the original privacy boundary.',
      },
      metrics: { records: 9, signatures: 9, approvals: 1, semanticConfidence: 95, drift: 0 },
    },
    {
      id: 'observe',
      label: 'Observe',
      eyebrow: 'Outcome observed',
      title: 'Runtime evidence closes the loop',
      description:
        'The pilot improves response time without residual message content. ACT retains the full path from intent through correction to observed outcome.',
      focusEventId: 'release-observation',
      visibleThrough: 10,
      callout: {
        tone: 'positive',
        label: 'Intent met',
        text: '38% faster first response; zero retained payloads.',
      },
      metrics: { records: 10, signatures: 10, approvals: 1, semanticConfidence: 96, drift: 0 },
    },
  ],
};
