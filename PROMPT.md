# ACT Protocol

## Accountability and Chain of Transformation

> An open protocol for preserving meaning, provenance, evidence, and accountable
> decisions across human and AI collaboration.

### Motto

> Trust is earned through accountability.
>
> Accountability is enabled by transparency.
>
> Transparency is achieved through verifiable transformations.

---

## Execution Directive

Act as a principal protocol designer, security engineer, distributed-systems
engineer, full-stack engineer, SDK author, formal-methods practitioner,
technical writer, and test engineer.

Build the complete ACT Protocol repository in the current workspace. Do not
respond with only a proposal, architecture sketch, sample, or implementation
plan. Create the files, install the dependencies, implement every required
component, run every available quality gate, fix failures, and leave a usable
version 1.0 release candidate.

This is a single-execution build specification. Every requirement in this
document is part of the required result. Do not leave unfinished-work markers,
empty packages, placeholder handlers, illustrative-only core logic, disabled
tests, or APIs that return fabricated data. A configurable external integration
is acceptable only when the repository also includes a deterministic local
implementation or emulator that makes the feature usable and testable without
paid services.

When a minor implementation detail is unspecified, choose the simplest secure
design consistent with this document, record the choice in an Architecture
Decision Record, and continue. Ask a question only when a genuinely external
decision makes correct implementation impossible.

The finished repository MUST be self-contained, reproducible, documented, secure
by default, and operable by a new contributor from the root README.

---

## Normative Language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**,
**SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **NOT RECOMMENDED**, **MAY**, and
**OPTIONAL** are to be interpreted as described by BCP 14 when, and only when,
they appear in all capitals.

Normative protocol behavior belongs in the specification. Explanatory material,
examples, and implementation notes MUST be clearly identified as non-normative.

---

## Objective

Design and implement **ACT (Accountability and Chain of Transformation)**, an
implementation-independent protocol and production-ready reference system that
enables people, AI systems, services, and organizations to collaborate while
preserving:

- human intent and its revisions
- semantic claims and their assessors
- artifact and transformation provenance
- decision and approval accountability
- assumptions, ambiguities, and alternatives
- multidimensional confidence
- explicit uncertainty
- evidence and verification results
- cryptographic integrity
- privacy and selective disclosure
- interoperable lineage

For any recorded artifact, ACT MUST make it possible to determine mechanically:

- its immutable identity and version
- the events and transformations that produced it
- the inputs, outputs, and typed lineage edges involved
- the actors and cryptographic identities associated with each event
- the applicable policies and approval decisions
- the assumptions and uncertainties explicitly recorded
- the evidence and verification records attached to it
- whether hashes, signatures, ledger receipts, and lineage are valid
- whether required records or approvals are missing, stale, revoked, or
  conflicting
- which intent baseline was used for a semantic assessment

ACT MUST make semantic conclusions inspectable and attributable. It MUST NOT
claim that arbitrary natural-language meanings can always be proven equivalent
by a machine. It MUST distinguish cryptographic facts, structural checks, policy
evaluations, automated assessments, formal proofs, and human judgments.

ACT is not an agent framework and not an orchestration engine. It is the
protocol that agents, orchestrators, IDEs, code generators, CI/CD systems,
governance tools, and organizations implement or consume.

---

## Core Principles

### 1. Trust Is Not a Primitive

Trust is an output of evidence, verification, provenance, policy, and explicit
trust decisions. A valid signature proves control of a key; it does not by
itself prove that the signer is truthful, authorized, competent, or trusted.

### 2. Every Transformation Leaves Evidence

Every transformation MUST record its inputs, outputs, actor, mode,
semantic-change claim, assumptions, ambiguities, rationale, alternatives,
confidence assessments, uncertainties, evidence, and applicable approval policy.
Fields that do not apply MUST use an explicit `not_applicable` representation
with a reason rather than being silently omitted.

### 3. Approval Is an Attributable Authorization Decision

Approval MUST be represented as a signed, policy-scoped attestation over an
exact immutable subject. Approval MAY authorize a state transition. It does not
erase or universally transfer the responsibilities of authors, operators,
deployers, organizations, or other participants.

### 4. Preservation and Discovery Are Distinct

ACT-P preserves an approved intent baseline. ACT-D proposes improvements or
challenges to that baseline. Discovery is encouraged; silent reinterpretation is
prohibited.

### 5. History Is Immutable; Interpretation Can Evolve

Events and signed artifact versions are immutable. Corrections, revocations,
supersessions, redactions, merges, and revised interpretations MUST be
represented by new events.

### 6. Privacy Is Part of Provenance

Transparency does not imply universal disclosure. ACT MUST support access
control, encryption, data minimization, selective disclosure, retention
policies, and cryptographic erasure while preserving verifiable metadata about
permitted removals.

### 7. No Hidden Global Authority

ACT MUST make trust roots, policy authorities, ledger operators, identity
providers, and conflict-resolution rules explicit. The protocol MUST NOT assume
a universally trusted server, clock, actor, model, or organization.

---

## Required Architecture Decisions

### Protocol Topology

ACT SHALL be a federated, content-addressed protocol.

The reference system MUST provide:

- a fully functional single-node deployment
- embedded operation with SQLite
- service operation with PostgreSQL
- signed event-bundle export and import between independent ledgers
- duplicate detection, partial-history handling, trust-policy evaluation, and
  quarantine of invalid or untrusted imports
- fork and equivocation detection based on immutable identities and causal
  lineage

Federation MUST NOT depend on global consensus or a universal event order.
Events MUST carry causal parent links. Each ledger MUST issue its own
tamper-evident receipt chain that establishes local acceptance order.

### Technology Stack

Use a polyglot monorepo with these required technologies:

- Node.js LTS and strict TypeScript for the core packages, CLI, and API service
- pnpm workspaces for JavaScript and TypeScript dependency management
- Fastify for the HTTP service
- JSON Schema 2020-12 with Ajv for authoritative runtime validation
- OpenAPI 3.1 for the HTTP contract
- SQLite for embedded and local operation
- PostgreSQL for production service operation
- React, TypeScript, and Vite for ACT Explorer
- a mature graph-visualization library such as Cytoscape.js for lineage views
- Python 3.12 or newer for the Python SDK
- a supported stable Go release for the Go SDK
- stable Rust for the Rust SDK
- Docker and Docker Compose for local deployment
- Helm manifests for Kubernetes deployment
- OpenTelemetry for traces and metrics

Use current stable dependency versions that are compatible with the selected
runtimes. Commit lockfiles. Avoid duplicating authoritative domain definitions:
generate language models and API clients from the JSON Schemas and OpenAPI
document where practical, then add hand-written cryptographic and ergonomic
layers.

### Required Repository Shape

The repository MUST contain, at minimum:

```text
/
|-- README.md
|-- LICENSE
|-- CHANGELOG.md
|-- SECURITY.md
|-- CONTRIBUTING.md
|-- GOVERNANCE.md
|-- Makefile
|-- package.json
|-- pnpm-lock.yaml
|-- spec/
|   |-- ACT-1.0.md
|   |-- semantic-model.md
|   |-- state-machines.md
|   |-- federation.md
|   |-- conformance.md
|-- formal/
|-- schemas/
|-- packages/
|   |-- core/
|   |-- crypto/
|   |-- ledger/
|   |-- policy/
|   |-- verification/
|   |-- sdk-typescript/
|-- services/
|   |-- api/
|-- apps/
|   |-- cli/
|   |-- explorer/
|-- sdks/
|   |-- python/
|   |-- go/
|   |-- rust/
|-- conformance/
|-- examples/
|-- docs/
|-- deploy/
|   |-- docker/
|   |-- compose/
|   |-- helm/
|-- scripts/
|-- tests/
```

Equivalent organization is allowed only when it improves build-system
conventions and is documented in an Architecture Decision Record.

The repository MUST use the Apache License 2.0 and semantic versioning. Protocol
version, implementation version, schema version, and API version MUST be
distinguishable.

---

## Protocol Data Model

### Identities and Versions

ACT MUST distinguish:

- a logical artifact ID, represented by UUIDv7
- an immutable artifact-version ID, derived from canonical content
- an event ID, derived from canonical event bytes
- a ledger ID
- a ledger-receipt ID
- an actor ID
- a key ID
- a policy ID and immutable policy version

Digest values MUST use the form `algorithm:encoded-value`. Version 1.0 MUST
support SHA-256. IDs derived from content MUST be recomputable and verified on
every untrusted read or import.

### Canonicalization and Signatures

Canonical JSON MUST follow RFC 8785 JSON Canonicalization Scheme. Protocol
schemas MUST avoid values whose cross-language representation is ambiguous.
Confidence scores, sequence numbers, and other bounded numeric fields SHOULD use
integers.

Signed events and receipts MUST use a DSSE-compatible envelope with an
ACT-specific payload type. The event ID MUST be the SHA-256 digest of the
canonical unsigned event payload. Signatures and storage metadata MUST NOT be
included in those canonical bytes.

Version 1.0 MUST support Ed25519 signatures. The specification MUST define an
algorithm registry and an extension process without allowing silent algorithm
downgrade.

Every signature MUST identify its key. Actor and key records MUST support
issuance, rotation, expiry, compromise, and revocation. Verification MUST report
separately:

- cryptographic signature validity
- event and content digest validity
- key status at signing and receipt time
- identity binding validity
- trust-policy acceptance
- authorization-policy acceptance

The implementation MUST NOT collapse those results into a single `valid` flag.

### Event Envelope

Define authoritative JSON Schemas for an unsigned event payload, a signed
envelope, and a ledger receipt. The unsigned event payload MUST include:

```yaml
protocol_version:
event_type:
occurred_at:
actor:
tenant:
subject:
causal_parents:
content_descriptors:
policy_context:
payload:
extensions:
```

The signed envelope MUST contain the canonical payload and one or more
signatures. The ledger receipt MUST contain:

```yaml
ledger_id:
sequence:
event_id:
accepted_at:
previous_receipt_digest:
receipt_digest:
signature:
```

The receipt digest MUST cover the previous receipt digest, making deletion,
insertion, reordering, or mutation detectable within a ledger history. Imported
source receipts MUST be preserved. A receiving ledger MUST add its own receipt
rather than rewriting the source receipt.

Wall-clock timestamps are claims. The protocol MUST preserve actor time and
ledger acceptance time separately and MUST define behavior for missing, skewed,
or untrusted clocks.

### Artifacts, Transformations, and Attestations

The semantic graph MUST use distinct node classes:

- **Artifact:** an immutable versioned semantic object
- **Transformation:** an operation relating one or more inputs to one or more
  outputs
- **Attestation:** a signed claim about an immutable subject
- **Policy:** versioned rules for authorization, approval, retention,
  verification, and trust
- **Evidence:** content or a content reference supporting a claim
- **Event:** an immutable statement that one of the above was created or changed
  in status

Lineage MUST be represented by typed, many-to-many edges from a new node to
existing nodes. Persisted signed records MUST NOT contain mutable `children`
arrays. Descendants and current state MUST be computed as projections.

Every non-genesis node MUST have at least one typed causal parent. Root records
MUST use an explicit Genesis event. External material MUST use an External
Import event that records the source and the limits of available provenance.

The ledger MUST reject cycles. It MUST support branches, merges, multiple
inputs, multiple outputs, revisions, partial imported histories, and
independently produced attestations.

### Artifact Types

Provide a shared artifact envelope and a distinct payload schema for every
required type:

- Intent
- Goal
- Constraint
- Requirement
- Assumption
- Ambiguity
- Risk
- Decision
- Architecture
- Task
- Prompt
- Tool Invocation
- Source Code
- Test
- Evidence
- Verification Report
- Runtime Observation
- User Feedback
- AI Proposal
- Human Proposal
- Approval Request
- Approval Decision
- Challenge
- Revision
- Policy
- Actor
- Key
- Accountability Assignment

Each artifact version MUST include or reference:

- logical and immutable version identifiers
- schema and protocol versions
- authoring actor
- creation time claim
- content media type, size, digest, and availability state
- typed lineage
- applicable policy versions
- confidence assessments
- uncertainty records
- evidence references
- signatures
- sensitivity and retention labels

Schemas MUST use strict validation, documented extension points, stable
enumerations, and reusable definitions. Unknown core fields MUST be rejected.
Extensions MUST use collision-resistant namespaces and MUST survive a read-write
round trip.

### Transformation Contract

Every transformation MUST record:

```yaml
transformation_id:
mode:
actor:
inputs:
outputs:
semantic_change_claim:
assumptions:
ambiguities:
alternatives:
rationale:
confidence_assessments:
uncertainties:
evidence:
verification_results:
applicable_policy:
approval_requirement:
```

`mode` MUST be `preservation` or `discovery`.

The semantic-change taxonomy MUST include:

- exact-preservation
- clarification
- constraint-refinement
- assumption-introduction
- alternative-proposal
- intent-challenge
- semantic-modification

A classification is an attributed claim, not automatically a fact.
`exact-preservation` MAY be mechanically verified only for transformations with
an applicable equivalence procedure, such as byte identity, canonical structural
equality, reproducible compilation evidence, or a cited formal proof.
Natural-language equivalence MUST identify an assessor, method, evidence,
confidence, and dispute status.

Policies MUST require approval for semantic modifications to an effective intent
baseline. They MAY require approval for other classifications. Policy
evaluation, rather than a mutable Boolean field, determines whether approval is
required.

### Intent Authority and Revision

ACT MUST distinguish:

- **root intent:** the immutable historical origin of an intent lineage
- **proposed intent:** a candidate that is not yet effective
- **effective intent:** the approved baseline selected by policy for a project
  or branch
- **intent revision:** a new immutable version linked to the version it changes
- **superseded intent:** a formerly effective version retained in history
- **merged intent:** a new version that explicitly reconciles two or more
  branches

No revision may overwrite an earlier intent. Concurrent or conflicting revisions
MUST create branches. A versioned authority policy MUST define who may select,
merge, or supersede an effective intent and whether quorum or separation of
duties is required. Until that policy is satisfied, the conflict MUST remain
explicit and no branch may silently win by timestamp or write order.

Drift assessments MUST identify their comparison target. The implementation MUST
support comparison against:

- the immediate parent, to explain a revision
- the current effective baseline, to assess implementation fidelity
- the root intent, to expose cumulative historical change

### Approval and Accountability

Approval MUST be a signed decision bound to an exact subject ID and digest. An
Approval Decision MUST include:

```yaml
decision_id:
request_id:
subject:
decision:
scope:
reviewer:
reviewer_authority:
policy_id:
policy_version:
conditions:
comments:
issued_at:
expires_at:
supersedes:
signature:
```

`decision` MUST be one of `approved`, `rejected`, or `changes_requested`.

The approval lifecycle MUST support:

```text
requested -> approved
requested -> rejected
requested -> changes_requested
requested -> cancelled
approved  -> expired
approved  -> revoked
approved  -> superseded
```

Every transition MUST be represented by a new signed event. Approval validity
MUST consider subject digest, policy version, reviewer authority, quorum,
conditions, expiry, key status, revocation, supersession, and any required
separation of duties. A new subject version MUST NOT inherit approval unless the
applicable policy explicitly permits a narrowly defined equivalence rule.

Accountability MUST be modeled independently through versioned assignments for
roles including proposer, author, reviewer, approver, executor, operator, owner,
and incident owner. Assignments MUST have scope, issuer, authority, start time,
end time, and status. Documentation MUST state that ACT records technical and
organizational claims and does not itself determine legal liability.

### Confidence

Confidence MUST be multidimensional and attributed. A confidence assessment MUST
contain:

- dimension
- integer score from 0 through 100 or `unassessed`
- assessor
- assessment method and method version
- evidence references
- calibration context
- timestamp
- rationale

Required dimensions are semantic, requirement, architectural, implementation,
verification, runtime, and source confidence.

The protocol MUST NOT compute a universal aggregate confidence score. A policy
MAY define a named projection for a specific decision. Such a projection MUST
retain all source assessments, formula, weights, thresholds, and policy version.

Derived artifacts MUST retain links to contributing confidence assessments.
Confidence MUST NOT automatically increase through transformation. The
verification toolkit MUST detect missing assessments, unsupported increases,
stale assessments, conflicting assessments, and policy-defined threshold
collapse.

### Uncertainty

An uncertainty record MUST include:

- identifier and description
- category: known-unknown, assumption, speculation, residual-risk, or
  human-input-required
- source and introducing transformation
- affected artifacts
- impact and likelihood assessments
- owner
- status
- resolution criteria
- inherited-from references
- resolving evidence or decision

Unresolved input uncertainties MUST propagate to derived outputs unless a
transformation explicitly discharges them with evidence. The protocol MUST
represent residual unknown risk without pretending to enumerate unknowable
facts.

### Evidence and Verification

Evidence MUST be immutable or content-addressed and MUST record origin,
collection method, custody, media type, digest, sensitivity, and limitations.

Verification results MUST use `pass`, `fail`, or `inconclusive`; identify the
verifier, method, method version, subject digest, evidence, execution
environment, time, confidence, and limitations; and remain independently
reproducible when the method permits it.

Implement these verification layers:

- schema and structural verification
- cryptographic and ledger-integrity verification
- provenance and lineage verification
- semantic assessment
- requirement coverage verification
- architecture-policy verification
- implementation and build verification
- behavior and test verification
- runtime verification
- human review
- formal verification
- independent AI assessment
- adversarial verification

Independent AI results MUST identify provider, model, model version when
available, prompt digest, tool configuration, sampling parameters, and output
digest. Private hidden reasoning MUST NOT be required. Store concise rationale
and evidence instead.

Challenges and disputes MUST be first-class signed attestations. A challenge
MUST identify the disputed claim, challenger, grounds, evidence, requested
remedy, and resolution status. Resolution MUST not delete the original claim.

---

## Semantic Drift and Verification Toolkit

Implement a verification toolkit that detects and explains:

- invalid schemas, hashes, signatures, keys, and receipt chains
- missing, broken, cyclic, or orphaned lineage
- incomplete imported history
- missing, stale, expired, revoked, superseded, or unauthorized approvals
- policy and quorum failures
- semantic-change claims without required evidence
- differences from immediate, effective, and root intent baselines
- introduced, propagated, discharged, and silently dropped assumptions
- unresolved ambiguities and uncertainties
- conflicting interpretations or attestations
- contradictory assumptions and requirements
- missing requirement-to-implementation and requirement-to-test coverage
- unsupported confidence increases and policy-defined confidence collapse
- unavailable, redacted, or digest-mismatched evidence
- forks, equivocation, replay, and duplicate events

Every finding MUST include a stable rule ID, severity, affected records,
evidence, explanation, remediation guidance, and whether the result is a
mechanical fact, policy result, heuristic assessment, or human judgment.

Provide three usable semantic assessors:

1. A deterministic structural and normalized-text assessor that runs offline.
2. A provider-neutral OpenAI-compatible assessor with prompt-injection defenses,
   strict structured output, retries, provenance capture, and configurable
   endpoint credentials.
3. A human assessment workflow in the API, CLI, and Explorer.

Automated semantic assessors MUST NOT silently approve semantic modifications.
They produce attestations that policy may require a human or organizational
authority to review.

---

## Privacy and Content Handling

Separate immutable event metadata from artifact content. A content descriptor
MUST include media type, byte length, digest, storage location or inline
representation, encryption metadata, sensitivity label, retention policy, and
availability state.

Implement:

- inline content for small non-sensitive payloads
- filesystem and database-backed content stores
- a storage-provider interface
- AES-256-GCM envelope encryption for protected content
- a key-provider interface with a usable local provider and documented
  production secret-injection pattern
- tenant isolation
- role- and policy-based access checks
- field and artifact sensitivity labels
- export filtering and selective disclosure
- retention evaluation
- signed redaction and deletion events
- cryptographic erasure by destroying content-encryption keys

Deletion MUST NOT rewrite signed history. It MUST leave the digest, deletion
authorization, reason, time, and resulting availability state while removing
content when policy requires it. Plaintext secrets, credentials, private keys,
and authentication tokens MUST never appear in logs, examples, fixtures,
exported diagnostics, or committed configuration.

Prompt and Tool Invocation artifacts MUST support redacted views. The
implementation MUST scan common secret formats before persistence and require an
explicit authorized override or redaction when sensitive values are detected.

---

## Identity, Authentication, and Authorization

Support actor types `human`, `ai-system`, `service`, `organization`, and
`group`.

The service MUST support:

- OIDC/OAuth 2.0 JWT validation for production users and services
- Ed25519 service identities for signed protocol events
- a clearly marked local development identity provider that is disabled in
  production mode
- tenant-scoped role-based access control
- policy-based authorization for sensitive actions
- separation-of-duties and quorum rules
- actor, key, group, role, and authority administration

Authentication, signature verification, trust, and authorization MUST remain
separate evaluations. API callers MUST NOT gain protocol authority merely
because they are authenticated.

---

## Threat Model and Security Requirements

Produce a structured threat model that identifies assets, actors, attacker
capabilities, trust boundaries, entry points, abuse cases, mitigations,
detection, and residual risk.

At minimum, analyze and test:

- prompt injection
- intent and specification laundering
- approval spoofing and approval fatigue
- semantic, goal, assumption, and requirement drift
- confidence inflation
- lineage and receipt-chain tampering
- hidden assumptions and hallucinated requirements
- missing or fabricated provenance
- key theft, misuse, rotation failure, and revocation bypass
- replay, rollback, fork, and equivocation attacks
- actor impersonation and identity-provider compromise
- confused-deputy and privilege-escalation attacks
- malicious or compromised verifiers
- schema downgrade and algorithm downgrade
- clock manipulation
- unauthorized disclosure and cross-tenant access
- content substitution and evidence deletion
- omission, censorship, and partial-history attacks
- denial of service and oversized graph or payload attacks
- webhook forgery and replay
- dependency, build, and tool supply-chain compromise

Implement secure defaults, strict input limits, rate limiting, request timeouts,
safe parsing, parameterized database access, output encoding, CORS and security
headers, webhook signatures, replay protection, audit logging, and least
privilege.

Generate an SBOM. Pin dependencies through lockfiles. Add automated dependency,
secret, static-analysis, and container-image checks. The release candidate MUST
have no known critical or high-severity vulnerabilities in shipped runtime
dependencies or container images.

---

## Storage and Operational Semantics

Implement a storage abstraction with behaviorally equivalent SQLite and
PostgreSQL adapters.

The ledger write path MUST atomically:

1. validate schema and limits
2. recompute identifiers and digests
3. verify signatures and key bindings
4. evaluate trust and authorization policy
5. verify causal parents or mark a permitted partial import
6. reject cycles and duplicates safely
7. append the immutable event and ledger receipt
8. update rebuildable projections
9. enqueue outbound events transactionally

Use idempotency keys and optimistic concurrency where commands depend on a
current head. Projections MUST be rebuildable solely from accepted events.
Include migration tooling, transactional migrations, seed data, backup and
restore commands, projection rebuild commands, corruption checks, and
operational documentation.

Define deterministic handling for duplicate events, duplicate idempotency keys,
missing parents, conflicting logical versions, imported forks, invalid
signatures, unavailable content, failed projection updates, and interrupted
imports.

---

## REST and Event APIs

Publish and implement a complete OpenAPI 3.1 contract under `/v1`.

Required resource families include:

```text
POST   /v1/intents
POST   /v1/transformations
POST   /v1/artifacts
POST   /v1/approval-requests
POST   /v1/approval-decisions
POST   /v1/challenges
POST   /v1/verifications
POST   /v1/revisions
POST   /v1/policies
POST   /v1/actors
POST   /v1/keys
POST   /v1/accountability-assignments
POST   /v1/bundles/export
POST   /v1/bundles/import

GET    /v1/artifacts/{id}
GET    /v1/artifacts/{id}/versions
GET    /v1/lineage/{id}
GET    /v1/history/{id}
GET    /v1/confidence/{id}
GET    /v1/uncertainty/{id}
GET    /v1/approvals/{id}
GET    /v1/verifications/{id}
GET    /v1/events
GET    /v1/events/stream
GET    /v1/schemas
GET    /v1/health/live
GET    /v1/health/ready
GET    /v1/metrics
```

Add the read, list, administration, revocation, supersession, redaction, and
policy-evaluation operations required to make every workflow complete.

The API MUST implement:

- bearer authentication and tenant scoping
- authorization checks on every protected operation
- idempotency keys for commands
- cursor pagination with stable ordering
- filtering and bounded graph traversal
- ETags and conditional requests where appropriate
- RFC 9457 Problem Details errors with stable ACT error codes
- request and response schema validation
- body, depth, and complexity limits
- correlation IDs
- Server-Sent Events using CloudEvents-compatible messages
- signed webhooks with retry, backoff, dead-letter handling, and replay
  protection
- an exposed OpenAPI document matching actual behavior

No API operation may mutate an accepted signed event. Commands that change
effective state MUST append events.

---

## SDKs

Deliver complete SDKs for TypeScript, Python, Go, and Rust. Each SDK MUST
provide:

- generated or schema-derived domain models
- strict validation
- RFC 8785 canonicalization
- SHA-256 identifiers and digests
- Ed25519 key generation, signing, and verification
- DSSE-compatible event envelopes
- key and trust-policy evaluation helpers
- synchronous and idiomatic asynchronous API clients where the language supports
  them
- authentication, pagination, idempotency, retries, timeouts, and structured
  errors
- bundle import and export helpers
- lineage traversal helpers
- runnable examples
- package documentation
- unit and integration tests
- publishable package metadata

Create cross-language conformance fixtures proving that every SDK computes
identical canonical bytes and IDs, verifies signatures produced by every other
SDK, rejects the same malformed inputs, and interoperates with the reference
API.

---

## CLI

Implement an `act` CLI covering:

```text
act init
act serve
act doctor
act actor
act key
act policy
act intent
act transform
act preserve
act discover
act approve
act reject
act revoke
act challenge
act verify
act lineage
act history
act diff
act audit
act explain
act import
act export
act redact
act projection rebuild
act backup
act restore
```

Commands MUST support human-readable output and stable JSON output, documented
exit codes, non-interactive automation, configuration files, environment
variables, stdin/stdout where appropriate, and safe secret handling. Destructive
or authority-bearing commands MUST display their exact subject and scope and
require an explicit confirmation flag in non-interactive use.

---

## ACT Explorer

Build a production-quality authenticated web application for inspecting and
operating ACT. It MUST be the usable application, not a marketing page.

Required workflows:

- browse, search, and filter artifacts and events
- inspect canonical content, signatures, receipts, policies, and evidence
- trace lineage backward and forward with bounded traversal
- compare artifact and intent versions
- submit and resolve approval requests
- create challenges and human assessments
- run verification and inspect explained findings
- inspect uncertainty propagation and confidence assessments
- import and export bundles subject to policy
- view redacted or unavailable content states correctly

Required visualizations:

- Intent Graph
- Transformation DAG
- Lineage Graph
- Approval Graph
- Responsibility Timeline
- Confidence Heatmap
- Intent Drift Timeline
- Decision Tree
- Evidence Graph

The interface MUST handle loading, empty, partial-history, unauthorized,
redacted, error, large-graph, and stale-data states. It MUST meet WCAG 2.2 AA
for core workflows, support keyboard navigation, avoid color-only meaning,
remain usable on desktop and mobile, and include Playwright end-to-end and
visual-regression tests at representative viewport sizes.

---

## Formal Specification and Semantic Model

Produce an RFC-style normative specification for ACT 1.0 containing:

- terminology and formal definitions
- protocol invariants
- canonicalization and cryptographic procedures
- event and receipt validation algorithms
- graph and lineage rules
- artifact and transformation semantics
- intent revision and merge semantics
- approval, challenge, revocation, and accountability state machines
- policy evaluation semantics
- confidence and uncertainty semantics
- federation and import semantics
- privacy and redaction semantics
- API-independent error conditions
- version negotiation and extension rules
- security and privacy considerations
- conformance requirements

Provide machine-readable state-machine definitions and a machine-checkable
formal model covering at least append-only receipt integrity, immutable history,
acyclic lineage, approval lifecycle safety, and prevention of an unauthorized
effective-intent transition. Include commands and tests that execute the model
checker reproducibly, using a container when host tooling is unavailable.

The semantic model MUST define Intent, Interpretation, Artifact, Transformation,
Revision, Evidence, Approval, Authorization, Accountability Assignment,
Confidence Assessment, Uncertainty, Verification, Validation, Provenance,
Challenge, Policy, Actor, Identity, Key, Event, Receipt, and Ledger.

---

## Conformance and Compatibility

Define ACT 1.0 conformance profiles for Core, Cryptographic Integrity, Secure
Service, Federation, SDK, and Explorer. The reference repository MUST satisfy
every profile.

Provide:

- normative positive and negative fixtures
- canonicalization and signature vectors
- schema compatibility fixtures
- state-machine transition fixtures
- graph and cycle fixtures
- approval and policy fixtures
- federation, fork, duplicate, and partial-history fixtures
- privacy and redaction fixtures
- executable conformance runners in all four SDK languages
- a machine-readable conformance report

Specify semantic-version compatibility, protocol negotiation, schema evolution,
field deprecation, extension namespaces, algorithm registration, and
unknown-event handling. A conforming implementation MUST never silently
reinterpret unknown normative data.

---

## Documentation and Research Foundation

Produce:

- a vision whitepaper
- the normative ACT 1.0 specification
- semantic-model documentation
- generated schema reference
- API and event API reference
- SDK guides for all four languages
- CLI reference
- Explorer user guide
- security and privacy guide
- threat model
- deployment and operations guide
- backup, restore, migration, and incident-response runbooks
- contributor and governance guides
- Architecture Decision Records
- a standards-adoption package describing governance, compatibility, extension
  registration, and proposal processes

Ground design choices in requirements engineering, formal methods,
programming-language theory, HCI, explainable AI, AI alignment, distributed
systems, knowledge representation, event sourcing, capability security,
proof-carrying code, epistemology, and organizational theory.

Compare ACT concretely with relevant work such as W3C PROV, in-toto, SLSA, DSSE,
Sigstore, Git, event-sourced systems, software bills of materials, requirements
traceability systems, model cards, data lineage systems, and policy engines.
Explain overlap, differences, and reasons for each ACT-specific mechanism.

Every citation and URL MUST be real, verified, and bibliographically sufficient.
Do not invent standards, papers, authors, or links. Limitations MUST describe
inherent boundaries and residual risks rather than missing required
implementation.

---

## Example Applications

Provide six executable, seeded examples:

1. A single human collaborating with an AI coding assistant.
2. A product team moving from intent through requirements, implementation,
   tests, and approval.
3. An AI-agent group producing competing proposals and a reviewed merge.
4. An enterprise workflow with OIDC identities, quorum approval, restricted
   evidence, and audit export.
5. An open-source collaboration with external contributions and signed bundle
   federation.
6. An illustrative safety-critical workflow with strict separation of duties,
   formal evidence, and an unresolved challenge that prevents release.

Each example MUST include signed fixtures, policies, assumptions, uncertainties,
evidence, approvals, at least one revision, verification output, CLI commands,
API calls, Explorer-visible data, and assertions proving the expected outcome.

Dogfood ACT by including a seed ledger that records this repository's initiating
intent, key architecture decisions, transformations, verification evidence, and
release approval. Clearly mark generated demonstration identities and keys as
non-production credentials.

---

## Deployment and Operations

Ship:

- hardened multi-stage Dockerfiles running as non-root users
- Docker Compose for API, PostgreSQL, Explorer, telemetry, and a local OIDC
  development provider
- a Helm chart with secure defaults, probes, resources, network policy, pod
  security settings, secrets references, persistence, and migration jobs
- environment and configuration reference
- database migrations and seed commands
- health, readiness, metrics, and tracing endpoints
- structured logs with redaction and correlation IDs
- graceful shutdown and transactional draining
- backup, restore, projection rebuild, and integrity-check commands
- a documented upgrade and rollback procedure
- a load-test scenario and recorded baseline

Production mode MUST fail closed when required secrets, trusted issuers,
encryption keys, or secure configuration are missing. Development shortcuts MUST
be explicit and MUST NOT activate in production mode.

---

## Quality Engineering

Implement and pass:

- formatting and lint checks
- strict TypeScript type checking
- unit tests
- property-based tests for canonicalization, hashing, graph invariants, and
  state machines
- SQLite and PostgreSQL integration tests
- API contract tests generated from OpenAPI
- cross-language SDK conformance tests
- CLI integration tests
- federation and import tests
- security and tenant-isolation tests
- cryptographic negative tests
- migration, backup, restore, and projection-rebuild tests
- Playwright Explorer tests and visual checks
- formal-model checks
- deterministic example tests
- load and resource-limit smoke tests
- documentation link and code-sample tests

Core protocol, cryptographic, policy, and ledger packages MUST maintain at least
90 percent branch coverage. The remaining first-party implementation MUST
maintain at least 80 percent branch coverage. Generated code, schema fixtures,
and declarative deployment manifests MAY be excluded with documented tooling
configuration.

Create one root command, `make verify`, that performs every offline quality
gate. Create `make verify-integration` for checks requiring Docker. Both
commands MUST fail on any skipped, disabled, focused, or unexpectedly pending
required test.

Continuous integration MUST run formatting, linting, type checking, all language
tests, conformance, security checks, builds, formal checks, container builds,
and end-to-end tests. Cache dependencies without weakening reproducibility.

---

## Required Acceptance Scenarios

Automate all of these scenarios:

1. Mutating an accepted event, artifact content, signature, sequence, or
   previous receipt causes integrity verification to fail with an explained
   finding.
2. A two-input transformation and a two-branch intent merge produce a valid DAG
   whose descendants are derived rather than stored in signed parents.
3. A semantically modified intent cannot become effective without the exact
   policy-required approvals and quorum.
4. Approval of one artifact version does not authorize a changed version;
   expiry, revocation, supersession, key revocation, and authority removal are
   enforced.
5. A conflicting concurrent intent remains branched until an authorized merge or
   selection event resolves it.
6. An unresolved uncertainty propagates to outputs; an evidence-backed discharge
   stops propagation while preserving history.
7. A semantic assessor records an attributed, contestable assessment and never
   represents heuristic similarity as mathematical proof.
8. Export from one ledger and import into another preserves source receipts,
   adds destination receipts, deduplicates replay, and quarantines invalid or
   untrusted events.
9. Missing parents and partial histories are represented explicitly and cannot
   masquerade as complete lineage.
10. Content redaction or cryptographic erasure removes plaintext while
    preserving authorized deletion evidence and immutable digests.
11. Cross-tenant reads, graph traversals, streams, exports, and content fetches
    are denied without authority.
12. TypeScript, Python, Go, and Rust produce identical event IDs and verify one
    another's signatures using shared vectors.
13. Every artifact in each example can be traced to an effective or root intent,
    or to an explicit External Import record.
14. Requirement coverage identifies an intentionally unimplemented example
    requirement and clears the finding after an implementation and test
    transformation are appended.
15. Backup and restore reproduce the same event IDs, receipt integrity,
    projections, and verification results.
16. Explorer users can inspect lineage, compare intent versions, review
    evidence, approve within authority, challenge a claim, and understand why a
    policy blocked an action.

---

## Definition of Done

The repository is complete only when all of the following are true:

- every required file, package, service, SDK, command, visualization, schema,
  example, and document exists and contains working content
- no required behavior is represented only by prose or a mock
- all generated artifacts can be regenerated deterministically
- all schemas validate their positive fixtures and reject their negative
  fixtures
- all four SDKs pass shared conformance tests
- SQLite and PostgreSQL exhibit equivalent protocol behavior
- the API implementation matches its OpenAPI contract
- Docker Compose starts a usable system with seeded data
- the Helm chart renders and passes static validation
- ACT Explorer passes end-to-end, accessibility, responsive-layout, and visual
  checks
- the threat model maps threats to implemented controls and tests
- integrity, privacy, authorization, federation, backup, and recovery scenarios
  pass
- `make verify` passes from a clean checkout
- `make verify-integration` passes with documented prerequisites
- production builds contain no development credentials or insecure fallback
  modes
- documentation links and commands are verified
- the root README provides a working quick start and an architecture overview
- the ACT dogfooding ledger verifies successfully

Before finishing, run the complete verification suite and repair failures.
Report the exact commands run and their outcomes. If an external prerequisite
cannot be exercised in the current environment, still provide its complete
implementation and deterministic local verification, then identify the
unavailable prerequisite precisely without claiming that its live check passed.

---

## Success Standard

ACT succeeds when humans and machines can consistently distinguish:

- immutable facts from mutable projections
- cryptographic validity from trust and authorization
- provenance from truth
- proposals from effective decisions
- approval from legal liability
- root intent from current effective intent
- preservation from discovery
- mechanical verification from heuristic or human semantic assessment
- known uncertainty from residual unknown risk
- transparent metadata from access-controlled content

Every transformation is attributable.

Every decision has provenance.

Every approval has explicit scope and authority.

Every artifact version has verifiable lineage or an explicit provenance
boundary.

Every claim can be verified, challenged, or identified honestly as unresolved.
