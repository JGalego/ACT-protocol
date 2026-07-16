#!/usr/bin/env node
// Deterministically generates schemas/artifact/types/*.schema.json from the
// table below, plus one positive and one negative fixture per type under
// schemas/artifact/types/fixtures/. Re-run after editing TYPES; do not hand
// edit the generated files.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const OUT_DIR = path.join(ROOT, 'schemas/artifact/types');
const FIXTURES_POS = path.join(OUT_DIR, 'fixtures/positive');
const FIXTURES_NEG = path.join(OUT_DIR, 'fixtures/negative');

const ENVELOPE_REF = 'https://schemas.act-protocol.org/1.0/artifact/artifact-envelope.schema.json';
const ACTOR_REF = 'https://schemas.act-protocol.org/1.0/common/actor-ref.schema.json';
const DIGEST_REF = 'https://schemas.act-protocol.org/1.0/common/digest.schema.json';
const UUID_REF = 'https://schemas.act-protocol.org/1.0/common/uuid.schema.json';
const CONFIDENCE_REF =
  'https://schemas.act-protocol.org/1.0/common/confidence-assessment.schema.json';

const SLUG_OVERRIDES = { AIProposal: 'ai-proposal' };

function kebab(name) {
  if (SLUG_OVERRIDES[name]) return SLUG_OVERRIDES[name];
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/\s+/g, '-')
    .toLowerCase();
}

// Each entry: { name, description, required, properties, example, negativeExample }
// `example`/`negativeExample` populate only the type-specific `data` object;
// the fixture generator wraps them in a minimal valid envelope.
const TYPES = [
  {
    name: 'Intent',
    description:
      'A stated purpose or objective, the root or a revision in an intent lineage (ACT-1.0.md section 7.3).',
    required: ['statement', 'scope'],
    properties: {
      statement: { type: 'string', minLength: 1 },
      scope: { type: 'string', minLength: 1 },
      priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
    },
    example: {
      statement: 'Provide a reference implementation of the ACT protocol.',
      scope: 'act-protocol repository',
    },
  },
  {
    name: 'Goal',
    description: 'A measurable objective in service of an Intent.',
    required: ['statement', 'success_criteria'],
    properties: {
      statement: { type: 'string', minLength: 1 },
      success_criteria: { type: 'array', items: { type: 'string' }, minItems: 1 },
      parent_intent_id: { $ref: UUID_REF },
    },
    example: {
      statement: 'Ship a working ledger.',
      success_criteria: ['make verify passes', 'receipt chain verified'],
    },
  },
  {
    name: 'Constraint',
    description: 'A boundary condition that limits acceptable solutions.',
    required: ['statement', 'constraint_type', 'hard'],
    properties: {
      statement: { type: 'string', minLength: 1 },
      constraint_type: { type: 'string', enum: ['technical', 'legal', 'business', 'resource'] },
      hard: { type: 'boolean' },
    },
    example: {
      statement: 'Must run offline without paid services.',
      constraint_type: 'technical',
      hard: true,
    },
  },
  {
    name: 'Requirement',
    description: 'A functional or non-functional requirement traceable to intent.',
    required: ['statement', 'requirement_type', 'priority', 'traces_to'],
    properties: {
      statement: { type: 'string', minLength: 1 },
      requirement_type: { type: 'string', enum: ['functional', 'non-functional'] },
      priority: { type: 'string', enum: ['must', 'should', 'could', 'wont'] },
      traces_to: { type: 'array', items: { $ref: UUID_REF } },
    },
    example: {
      statement: 'Ledger receipts must be hash-chained.',
      requirement_type: 'functional',
      priority: 'must',
      traces_to: [],
    },
  },
  {
    name: 'Assumption',
    description: 'A stated belief taken as true without full verification.',
    required: ['statement', 'validated'],
    properties: {
      statement: { type: 'string', minLength: 1 },
      confidence_basis: { type: 'string' },
      validated: { type: 'boolean' },
    },
    example: { statement: 'The reviewer has release authority.', validated: false },
  },
  {
    name: 'Ambiguity',
    description: 'A recorded point where meaning is not yet settled.',
    required: ['description', 'candidate_interpretations', 'resolved'],
    properties: {
      description: { type: 'string', minLength: 1 },
      candidate_interpretations: { type: 'array', items: { type: 'string' }, minItems: 1 },
      resolved: { type: 'boolean' },
    },
    example: {
      description: '"fast" is not quantified.',
      candidate_interpretations: ['p50 < 100ms', 'p99 < 500ms'],
      resolved: false,
    },
  },
  {
    name: 'Risk',
    description: 'A recorded potential negative outcome.',
    required: ['description', 'likelihood', 'impact'],
    properties: {
      description: { type: 'string', minLength: 1 },
      likelihood: { type: 'string', enum: ['low', 'medium', 'high'] },
      impact: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
      mitigation: { type: 'string' },
    },
    example: {
      description: 'Key compromise before rotation.',
      likelihood: 'low',
      impact: 'high',
      mitigation: 'short rotation window',
    },
  },
  {
    name: 'Decision',
    description: 'A recorded choice among considered options.',
    required: ['statement', 'options_considered', 'chosen_option', 'rationale'],
    properties: {
      statement: { type: 'string', minLength: 1 },
      options_considered: { type: 'array', items: { type: 'string' }, minItems: 1 },
      chosen_option: { type: 'string', minLength: 1 },
      rationale: { type: 'string', minLength: 1 },
    },
    example: {
      statement: 'Storage engine for embedded mode.',
      options_considered: ['SQLite', 'LevelDB'],
      chosen_option: 'SQLite',
      rationale: 'ubiquitous, transactional, zero-config',
    },
  },
  {
    name: 'Architecture',
    description: 'A recorded architectural structure or decision surface.',
    required: ['title', 'description', 'components'],
    properties: {
      title: { type: 'string', minLength: 1 },
      description: { type: 'string', minLength: 1 },
      components: { type: 'array', items: { type: 'string' }, minItems: 1 },
      diagram_ref: { $ref: DIGEST_REF },
    },
    example: {
      title: 'Ledger write path',
      description: 'Atomic 9-step append',
      components: ['validator', 'store', 'projector'],
    },
  },
  {
    name: 'Task',
    description: 'A unit of planned or completed work.',
    required: ['title', 'description', 'status'],
    properties: {
      title: { type: 'string', minLength: 1 },
      description: { type: 'string', minLength: 1 },
      status: { type: 'string', enum: ['open', 'in_progress', 'done', 'blocked'] },
      assignee: { $ref: ACTOR_REF },
    },
    example: {
      title: 'Implement receipt chain',
      description: 'Hash-chain ledger receipts',
      status: 'done',
    },
  },
  {
    name: 'Prompt',
    description:
      'A recorded prompt exchanged with an AI system, redactable per ACT-1.0.md section 15.',
    required: ['role', 'content', 'redacted'],
    properties: {
      role: { type: 'string', enum: ['system', 'user', 'assistant', 'tool'] },
      content: { type: 'string' },
      redacted: { type: 'boolean' },
    },
    example: { role: 'user', content: 'Implement the ledger write path.', redacted: false },
  },
  {
    name: 'ToolInvocation',
    description: 'A recorded invocation of a tool by an actor, redactable.',
    required: ['tool_name', 'arguments_digest', 'redacted'],
    properties: {
      tool_name: { type: 'string', minLength: 1 },
      arguments_digest: { $ref: DIGEST_REF },
      result_digest: { $ref: DIGEST_REF },
      redacted: { type: 'boolean' },
    },
    example: {
      tool_name: 'write_file',
      arguments_digest: 'sha-256:' + '1'.repeat(64),
      redacted: false,
    },
  },
  {
    name: 'SourceCode',
    description: 'A versioned source-code artifact.',
    required: ['language', 'path'],
    properties: {
      language: { type: 'string', minLength: 1 },
      path: { type: 'string', minLength: 1 },
      repository_ref: { type: 'string' },
    },
    example: { language: 'typescript', path: 'packages/core/src/canonical.ts' },
  },
  {
    name: 'Test',
    description: 'A test definition or run record.',
    required: ['name', 'framework', 'status'],
    properties: {
      name: { type: 'string', minLength: 1 },
      framework: { type: 'string', minLength: 1 },
      status: { type: 'string', enum: ['passing', 'failing', 'skipped'] },
      coverage_percent: { type: 'integer', minimum: 0, maximum: 100 },
    },
    example: { name: 'canonicalizes RFC 8785 vectors', framework: 'vitest', status: 'passing' },
  },
  {
    name: 'Evidence',
    description: 'Immutable or content-addressed support for a claim (ACT-1.0.md section 11.1).',
    required: ['origin', 'collection_method', 'custody', 'limitations'],
    properties: {
      origin: { type: 'string', minLength: 1 },
      collection_method: { type: 'string', minLength: 1 },
      custody: { type: 'array', items: { $ref: ACTOR_REF }, minItems: 1 },
      limitations: { type: 'string' },
    },
    example: {
      origin: 'CI run 1234',
      collection_method: 'automated test execution',
      custody: [
        { actor_id: '018f5b1a-0000-7000-8000-000000000001', key_id: 'ed25519:' + 'a'.repeat(16) },
      ],
      limitations: 'covers only the happy path',
    },
  },
  {
    name: 'VerificationReport',
    description: 'A verification result (ACT-1.0.md section 11.3).',
    required: [
      'result',
      'verifier',
      'method',
      'method_version',
      'subject_digest',
      'execution_environment',
      'limitations',
    ],
    properties: {
      result: { type: 'string', enum: ['pass', 'fail', 'inconclusive'] },
      verifier: { $ref: ACTOR_REF },
      method: { type: 'string', minLength: 1 },
      method_version: { type: 'string', minLength: 1 },
      subject_digest: { $ref: DIGEST_REF },
      execution_environment: { type: 'string', minLength: 1 },
      confidence: CONFIDENCE_REF ? { $ref: CONFIDENCE_REF } : undefined,
      limitations: { type: 'string' },
    },
    example: {
      result: 'pass',
      verifier: {
        actor_id: '018f5b1a-0000-7000-8000-000000000002',
        key_id: 'ed25519:' + 'b'.repeat(16),
      },
      method: 'schema-validation',
      method_version: '1.0.0',
      subject_digest: 'sha-256:' + '2'.repeat(64),
      execution_environment: 'node-22.23.1',
      limitations: 'structural only',
    },
  },
  {
    name: 'RuntimeObservation',
    description: 'An observed runtime measurement.',
    required: ['observed_at', 'metric_name', 'value', 'environment'],
    properties: {
      observed_at: { type: 'string', format: 'date-time' },
      metric_name: { type: 'string', minLength: 1 },
      value: { type: 'number' },
      environment: { type: 'string', minLength: 1 },
    },
    example: {
      observed_at: '2026-07-16T00:00:00Z',
      metric_name: 'ledger_append_latency_ms',
      value: 4.2,
      environment: 'staging',
    },
  },
  {
    name: 'UserFeedback',
    description: 'Feedback from a human user.',
    required: ['comment'],
    properties: {
      rating: { type: 'integer', minimum: 1, maximum: 5 },
      comment: { type: 'string', minLength: 1 },
      sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
    },
    example: { comment: 'Verification output was clear.', sentiment: 'positive' },
  },
  {
    name: 'AIProposal',
    description: 'A proposal authored by an AI system.',
    required: ['proposer', 'model', 'content_digest', 'rationale'],
    properties: {
      proposer: { $ref: ACTOR_REF },
      model: { type: 'string', minLength: 1 },
      model_version: { type: 'string' },
      content_digest: { $ref: DIGEST_REF },
      rationale: { type: 'string', minLength: 1 },
    },
    example: {
      proposer: {
        actor_id: '018f5b1a-0000-7000-8000-000000000003',
        key_id: 'ed25519:' + 'c'.repeat(16),
      },
      model: 'claude-sonnet-5',
      content_digest: 'sha-256:' + '3'.repeat(64),
      rationale: 'refactor for clarity',
    },
  },
  {
    name: 'HumanProposal',
    description: 'A proposal authored by a human.',
    required: ['proposer', 'content_digest', 'rationale'],
    properties: {
      proposer: { $ref: ACTOR_REF },
      content_digest: { $ref: DIGEST_REF },
      rationale: { type: 'string', minLength: 1 },
    },
    example: {
      proposer: {
        actor_id: '018f5b1a-0000-7000-8000-000000000004',
        key_id: 'ed25519:' + 'd'.repeat(16),
      },
      content_digest: 'sha-256:' + '4'.repeat(64),
      rationale: 'align with updated requirement',
    },
  },
  {
    name: 'ApprovalRequest',
    title: 'ApprovalRequestArtifact',
    description:
      'Wraps schemas/approval/approval-request.schema.json as a lineage-tracked artifact.',
    required: ['request'],
    properties: {
      request: {
        $ref: 'https://schemas.act-protocol.org/1.0/approval/approval-request.schema.json',
      },
    },
    example: null,
  },
  {
    name: 'ApprovalDecision',
    title: 'ApprovalDecisionArtifact',
    description:
      'Wraps schemas/approval/approval-decision.schema.json as a lineage-tracked artifact.',
    required: ['decision'],
    properties: {
      decision: {
        $ref: 'https://schemas.act-protocol.org/1.0/approval/approval-decision.schema.json',
      },
    },
    example: null,
  },
  {
    name: 'Challenge',
    title: 'ChallengeArtifact',
    description: 'Wraps schemas/challenge/challenge.schema.json as a lineage-tracked artifact.',
    required: ['challenge'],
    properties: {
      challenge: { $ref: 'https://schemas.act-protocol.org/1.0/challenge/challenge.schema.json' },
    },
    example: null,
  },
  {
    name: 'Revision',
    description:
      'Marks an artifact version as a revision of a prior version, independent of the generic lineage edge.',
    required: ['revises_version_id', 'revision_reason', 'revision_kind'],
    properties: {
      revises_version_id: { $ref: DIGEST_REF },
      revision_reason: { type: 'string', minLength: 1 },
      revision_kind: {
        type: 'string',
        enum: ['clarification', 'correction', 'supersession', 'merge'],
      },
    },
    example: {
      revises_version_id: 'sha-256:' + '5'.repeat(64),
      revision_reason: 'clarified ambiguous wording',
      revision_kind: 'clarification',
    },
  },
  {
    name: 'Policy',
    title: 'PolicyArtifact',
    description: 'Wraps schemas/policy/policy.schema.json as a lineage-tracked artifact.',
    required: ['policy'],
    properties: {
      policy: { $ref: 'https://schemas.act-protocol.org/1.0/policy/policy.schema.json' },
    },
    example: null,
  },
  {
    name: 'Actor',
    description: 'A registered protocol actor.',
    required: ['actor_type', 'display_name', 'keys'],
    properties: {
      actor_type: {
        type: 'string',
        enum: ['human', 'ai-system', 'service', 'organization', 'group'],
      },
      display_name: { type: 'string', minLength: 1 },
      keys: { type: 'array', items: { type: 'string' } },
    },
    example: {
      actor_type: 'human',
      display_name: 'Jane Reviewer',
      keys: ['ed25519:' + 'e'.repeat(16)],
    },
  },
  {
    name: 'Key',
    description: 'A cryptographic key bound to an actor.',
    required: ['key_id', 'algorithm', 'public_key', 'status', 'owner_actor_id'],
    properties: {
      key_id: { type: 'string', minLength: 1 },
      algorithm: { type: 'string', enum: ['ed25519'] },
      public_key: { type: 'string', minLength: 1 },
      status: {
        type: 'string',
        enum: ['issued', 'active', 'rotated', 'expired', 'revoked', 'compromised'],
      },
      owner_actor_id: { $ref: UUID_REF },
    },
    example: {
      key_id: 'ed25519:' + 'f'.repeat(16),
      algorithm: 'ed25519',
      public_key: 'base64-encoded-placeholder',
      status: 'active',
      owner_actor_id: '018f5b1a-0000-7000-8000-000000000005',
    },
  },
  {
    name: 'AccountabilityAssignment',
    description:
      'A versioned assignment of a role to an actor over a scope and time window (ACT-1.0.md section 8.4).',
    required: ['role', 'assignee', 'scope', 'issuer', 'authority', 'start_time', 'status'],
    properties: {
      role: {
        type: 'string',
        enum: [
          'proposer',
          'author',
          'reviewer',
          'approver',
          'executor',
          'operator',
          'owner',
          'incident_owner',
        ],
      },
      assignee: { $ref: ACTOR_REF },
      scope: { type: 'string', minLength: 1 },
      issuer: { $ref: ACTOR_REF },
      authority: { type: 'string', minLength: 1 },
      start_time: { type: 'string', format: 'date-time' },
      end_time: { oneOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
      status: { type: 'string', enum: ['active', 'ended', 'revoked'] },
    },
    example: {
      role: 'reviewer',
      assignee: {
        actor_id: '018f5b1a-0000-7000-8000-000000000006',
        key_id: 'ed25519:' + 'a'.repeat(16),
      },
      scope: 'act-protocol/packages/ledger',
      issuer: {
        actor_id: '018f5b1a-0000-7000-8000-000000000007',
        key_id: 'ed25519:' + 'b'.repeat(16),
      },
      authority: 'project-maintainer',
      start_time: '2026-07-16T00:00:00Z',
      status: 'active',
    },
  },
];

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(FIXTURES_POS, { recursive: true });
mkdirSync(FIXTURES_NEG, { recursive: true });

const index = [];

for (const t of TYPES) {
  const fileSlug = kebab(t.name);
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `https://schemas.act-protocol.org/1.0/artifact/types/${fileSlug}.schema.json`,
    title: t.title ?? t.name,
    description: t.description,
    allOf: [
      { $ref: ENVELOPE_REF },
      {
        type: 'object',
        required: ['artifact_type', 'data'],
        properties: {
          artifact_type: { const: t.name },
          data: {
            type: 'object',
            additionalProperties: false,
            required: t.required,
            properties: Object.fromEntries(
              Object.entries(t.properties).filter(([, v]) => v !== undefined),
            ),
          },
        },
      },
    ],
  };
  writeFileSync(
    path.join(OUT_DIR, `${fileSlug}.schema.json`),
    JSON.stringify(schema, null, 2) + '\n',
  );
  index.push({ name: t.name, file: `${fileSlug}.schema.json`, id: schema.$id });

  if (t.example) {
    writeFileSync(
      path.join(FIXTURES_POS, `${fileSlug}.data.json`),
      JSON.stringify(t.example, null, 2) + '\n',
    );
    // Negative fixture: strip the first required field.
    const negative = { ...t.example };
    delete negative[t.required[0]];
    writeFileSync(
      path.join(FIXTURES_NEG, `${fileSlug}.data.missing-${t.required[0]}.json`),
      JSON.stringify(negative, null, 2) + '\n',
    );
  }
}

writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify({ types: index }, null, 2) + '\n');

console.log(`Generated ${TYPES.length} artifact type schemas in ${OUT_DIR}`);
