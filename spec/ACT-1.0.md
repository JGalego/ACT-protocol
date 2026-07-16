# ACT 1.0: Accountability and Chain of Transformation

Status: Release Candidate 1.0.0-rc.1
Editors: ACT Protocol Maintainers

## 0. Notational Conventions

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**,
**SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **NOT RECOMMENDED**, **MAY**, and
**OPTIONAL** in this document are to be interpreted as described in
[BCP 14](https://www.rfc-editor.org/info/bcp14) (RFC 2119, RFC 8174), when,
and only when, they appear in all capitals.

Sections and paragraphs marked **Non-normative** are explanatory. All other
material is normative. Where this document and a JSON Schema under
`schemas/` disagree, the JSON Schema is authoritative for structural
validation and this document is authoritative for behavioral semantics; a
disagreement is a defect to be fixed, not a license to pick either.

This is the ACT 1.0 specification. It is implementation-independent: any
system that satisfies the requirements below and the relevant conformance
profile (`spec/conformance.md`) is a conforming ACT implementation,
independent of the reference implementation in this repository.

## 1. Introduction

**Non-normative.** ACT (Accountability and Chain of Transformation) is a
protocol for recording, evolving, and verifying the provenance of
human/AI/organizational work: intents, the artifacts derived from them, the
transformations that produced those artifacts, and the approvals,
challenges, evidence, confidence, and uncertainty attached along the way.
ACT is not an agent framework, an orchestration engine, or a workflow
engine. It defines a data model, cryptographic envelope, ledger semantics,
and verification vocabulary that such systems can implement or consume.

ACT succeeds when a conforming implementation lets a human or a machine
mechanically distinguish the categories enumerated in `PROMPT.md`'s Success
Standard — e.g., immutable facts from mutable projections, cryptographic
validity from trust and authorization, and mechanical verification from
heuristic or human semantic assessment — for any artifact it manages.

## 2. Terminology

This section gives normative, one-paragraph definitions. `spec/semantic-model.md`
gives the full formal semantic model with relations between these terms.

- **Actor**: an identity of type `human`, `ai-system`, `service`,
  `organization`, or `group` that can be the subject of a key binding and
  the author of events.
- **Artifact**: an immutable, versioned semantic object of one of the
  Artifact Types in §8. A **logical artifact** is identified by a UUIDv7
  `artifact_id`; each **artifact version** is a distinct immutable record
  identified by a content-derived digest.
- **Attestation**: a signed claim made by an actor about an immutable
  subject (an artifact version, event, or another attestation). Approval
  Decisions, Verification Reports, and Challenges are attestation kinds.
- **Event**: an immutable, signed statement that an Artifact, Transformation,
  Attestation, or Policy was created or changed status. Events are the only
  way protocol state changes; see §5.
- **Transformation**: an operation with one or more input artifact versions
  and one or more output artifact versions, tagged with a `mode` of
  `preservation` or `discovery` and a semantic-change classification (§7.2).
- **Policy**: a versioned, immutable document defining authorization,
  approval, retention, verification, or trust rules, evaluated
  deterministically against a request and the current graph state.
- **Evidence**: content, or a reference to content, that supports a claim
  made in an Attestation or Verification Report.
- **Ledger**: an append-only, hash-chained store of Events for one
  federation participant, identified by a `ledger_id`. See §6 and
  `spec/federation.md`.
- **Receipt**: a signed record a ledger issues when it accepts an event,
  establishing that ledger's local acceptance order. See §5.3.
- **Root intent**, **effective intent**, **proposed intent**: see §7.3.
- **Confidence assessment**, **uncertainty record**: see §9 and §10.

## 3. Identities and Versions

A conforming implementation MUST distinguish the following identifier
kinds, and MUST NOT use one kind's identifier where another is required:

| Kind                       | Form                                                     | Mutable?                                                              |
| -------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------- |
| Logical artifact ID        | UUIDv7                                                   | The ID is stable; it denotes a lineage, not a single immutable value. |
| Artifact-version ID        | `sha-256:<base16>` of canonical version content          | Immutable                                                             |
| Event ID                   | `sha-256:<base16>` of canonical unsigned event payload   | Immutable                                                             |
| Ledger ID                  | UUIDv7, generated at ledger initialization               | Immutable once issued                                                 |
| Ledger-receipt ID          | `<ledger_id>:<sequence>`                                 | Immutable                                                             |
| Actor ID                   | UUIDv7                                                   | Stable; MAY accumulate multiple keys over time                        |
| Key ID                     | `<algorithm>:<base16 public key fingerprint>`            | Immutable; a rotation issues a new Key ID                             |
| Policy ID / policy version | UUIDv7 logical ID + immutable content digest per version | Versions immutable; ID stable                                         |

Digest values MUST use the form `algorithm:encoded-value`, e.g.
`sha-256:9f86d0...`. Version 1.0 implementations MUST support SHA-256
(`sha-256`) and MUST reject digests naming an unregistered algorithm rather
than guessing an interpretation. §4.4 defines the algorithm registry.

Any identifier derived from content (artifact-version ID, event ID) MUST be
recomputed and compared on every untrusted read or import; an
implementation MUST NOT trust a stored or transmitted identifier without
recomputation at trust boundaries (see `spec/conformance.md` fixture
`crypto/digest-mismatch`).

## 4. Canonicalization and Signatures

### 4.1 Canonical JSON

Canonical JSON MUST follow
[RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) (JSON Canonicalization
Scheme, JCS). Protocol schemas MUST avoid field values whose cross-language
representation is ambiguous under JCS — in particular, floating-point
values that cannot round-trip exactly. Confidence scores, sequence
numbers, and other bounded numeric fields SHOULD be represented as
integers for this reason (§9 uses an integer 0-100 scale).

### 4.2 Signed Envelope

Signed events and receipts MUST use a
[DSSE](https://github.com/secure-systems-lab/dsse)-compatible envelope with
payload type `application/vnd.act.event+json` (unsigned events) or
`application/vnd.act.receipt+json` (receipts). See
`schemas/envelope/signed-envelope.schema.json`.

The event ID MUST be the SHA-256 digest of the canonical (RFC 8785) bytes of
the **unsigned** event payload. Signatures, the DSSE `payloadType` framing,
and any storage metadata MUST NOT be included in the bytes that are hashed
or signed over as the "payload" — i.e., the event ID is stable across
re-serialization and across the number or order of signatures attached.

### 4.3 Signature Algorithms

Version 1.0 implementations MUST support Ed25519
([RFC 8032](https://www.rfc-editor.org/rfc/rfc8032)) signatures.

### 4.4 Algorithm Registry and Downgrade Protection

`schemas/registry/algorithms.json` is the authoritative registry of
signature and digest algorithm identifiers. Adding an algorithm is an
additive, non-breaking schema change (a new registry entry) that MUST ship
with conformance vectors before any implementation may produce signatures
using it. An implementation MUST reject an envelope or digest that names an
algorithm not present in its configured registry, and MUST NOT silently
reinterpret an unrecognized algorithm identifier as a known one
("algorithm downgrade"). Removing or deprecating an algorithm is a
protocol-version-relevant change (§16).

### 4.5 Verification Result Separation

Verifying a signed event or receipt MUST report the following as
independent results, never collapsed into one `valid` boolean:

1. cryptographic signature validity (does the signature verify against the
   claimed public key over the canonical bytes)
2. event/content digest validity (does recomputing the digest match the
   claimed identifier)
3. key status at signing time and at receipt time (active / rotated /
   expired / revoked / compromised — §11.2)
4. identity binding validity (is the signing key bound to the claimed
   actor)
5. trust-policy acceptance (is this actor/key trusted for this action under
   the evaluating party's trust policy — §6.4)
6. authorization-policy acceptance (does policy permit this actor to
   perform this action on this subject — §12)

A `pass` on (1)-(2) and a `fail` on (5)-(6) is a normal, expected outcome
(e.g., a validly signed event from an untrusted actor) and MUST be
representable and distinguishable from a cryptographic failure.

## 5. Event Envelope and Ledger Receipts

### 5.1 Unsigned Event Payload

Defined authoritatively by
`schemas/event/unsigned-event.schema.json`. Required top-level fields:

```yaml
protocol_version:   # e.g. "act/1.0"
event_type:         # enum, see schemas/event/event-type.schema.json
occurred_at:        # actor-claimed wall-clock time (RFC 3339)
actor:              # { actor_id, key_id }
tenant:             # tenant identifier, or "not_applicable" with reason
subject:            # { kind, artifact_id?, version_id?, ... } — what this event is about
causal_parents:     # array of { event_id } — see §5.4; empty only for Genesis
content_descriptors:# array of content descriptors (see spec/privacy semantics, docs)
policy_context:      # { policy_id, policy_version } applicable at authoring time, or not_applicable
payload:             # event-type-specific body (e.g., the artifact version, the transformation record)
extensions:          # namespaced extension object, see §16.3
```

### 5.2 Signed Envelope

The signed envelope contains the canonical unsigned payload (or a reference
to it, per the DSSE encoding) and one or more `{ key_id, algorithm,
signature }` signature records. An event MAY be co-signed by more than one
actor (e.g., a required dual-control action); a conforming implementation
MUST verify every attached signature independently and MUST NOT treat one
valid signature as implying the validity of others.

### 5.3 Ledger Receipt

`schemas/event/ledger-receipt.schema.json` defines:

```yaml
ledger_id:
sequence: # monotonically increasing per ledger_id, starting at 0
event_id:
accepted_at: # ledger-observed acceptance time — distinct from occurred_at
previous_receipt_digest: # digest of the immediately preceding receipt in this ledger, or the
  # ledger's defined genesis constant for sequence 0
receipt_digest: # digest covering this receipt's own fields, including previous_receipt_digest
signature: # ledger's own signature over receipt_digest
```

Because `receipt_digest` covers `previous_receipt_digest`, the full receipt
sequence for a ledger forms a hash chain: deleting, inserting, reordering,
or mutating any past receipt is detectable by any party holding a later
receipt in the chain (`spec/conformance.md` fixtures `ledger/tamper-*`).

When one ledger imports events that another ledger already issued
receipts for, it MUST preserve the imported (source) receipts unmodified
and MUST append its own new receipt for the import event; it MUST NOT
rewrite or replace a source receipt (§14, `spec/federation.md`).

### 5.4 Causal Parents, Genesis, and External Import

Every non-genesis event MUST declare at least one entry in
`causal_parents`, naming the event(s) it is causally dependent on (e.g.,
the event that created an input artifact version). An event with an empty
`causal_parents` array MUST have `event_type: genesis` and MUST be the
first event for its subject's lineage. Material originating outside ACT
(e.g., an imported Git history, an externally authored document) MUST be
represented by an `external_import` event that names its `event_type`,
records the external source identifier and a description of the limits of
available provenance (e.g., "history prior to commit X is not available"),
and MUST NOT claim complete lineage it cannot substantiate.

### 5.5 Clocks

`occurred_at` is an actor-supplied wall-clock claim and MUST be treated as
untrusted input, not as ordering evidence. `accepted_at` is the receiving
ledger's own clock reading and establishes only that ledger's local
observation time. Causal order between events, where required (e.g.,
lineage, receipt sequencing), MUST be established through
`causal_parents` and `sequence`, never through `occurred_at` comparison.
A conforming implementation MUST define and document its behavior for
missing, skewed (relative to receipt time), or clearly-in-the-future
`occurred_at` values (flag as a finding; do not reject outright, since a
skewed actor clock is not evidence of an invalid event).

## 6. Ledger and Storage Semantics

### 6.1 Write Path

A ledger's write path for a submitted signed event MUST, atomically:

1. validate the envelope against its JSON Schema and configured size/depth
   limits
2. recompute the event ID and any referenced content digests
3. verify every attached signature and its key binding
4. evaluate trust policy (is this actor/key trusted to submit this event
   type for this subject) and authorization policy (§12)
5. verify that every `causal_parents` entry is either already accepted by
   this ledger or the event is explicitly marked as a permitted partial
   import (§14.3)
6. reject the event if accepting it would introduce a lineage cycle (§8.4)
   or if it is a duplicate of an already-accepted event (by event ID) —
   duplicate submission MUST be idempotent (return the existing receipt,
   not an error and not a second receipt)
7. append the event and issue a ledger receipt chained to the previous
   receipt
8. update rebuildable projections (§6.2)
9. enqueue any outbound notifications transactionally with the append

If any step 1-6 fails, no receipt is issued and no projection is updated.
Steps 7-9 MUST be atomic with respect to a crash: a projection or outbound
enqueue MUST NOT be observable without its causing event being durably
accepted, and an accepted event MUST NOT be lost even if projection update
or enqueue subsequently fails (a failed projection update is recorded as a
pending-rebuild condition, not a lost event).

### 6.2 Projections

All mutable, queryable state (current artifact-version pointers, lineage
adjacency, approval status, confidence indexes) MUST be a projection
computed solely from the accepted event sequence. A conforming
implementation MUST provide a projection-rebuild operation that reproduces
identical projection state from the event log alone, with no other input.
Signed records MUST NOT contain mutable `children` or "current state"
arrays; only forward-pointing, typed edges from a new event to the prior
state it depends on are signed. Descendants, current heads, and other
"looking forward" views are always computed.

### 6.3 Cycle and Duplicate Handling

The ledger MUST reject any event whose acceptance would create a cycle in
the causal-parent graph restricted to lineage-typed edges. It MUST detect
this before appending, not through later graph validation. Ledgers MUST
support: branches (multiple children of one parent), merges (multiple
`causal_parents` on one event), multiple inputs and outputs on a single
Transformation event, revisions, and partial imported histories with
explicitly marked missing parents (§5.4, §14.3).

### 6.4 Trust Policy

A ledger's trust policy determines which actors/keys it accepts events
from and under what conditions it accepts imported events from another
ledger. Trust policy is local, versioned, and explicit; a conforming
implementation MUST NOT ship a default trust policy that silently trusts
every remote ledger or every imported signature. See
`spec/federation.md` §3.

## 7. Artifacts, Transformations, and Intent

### 7.1 Node Classes and Lineage

The semantic graph has five signed node classes — Artifact, Transformation,
Attestation, Policy, Evidence — plus Events, which are the append-only
record of changes to the other four. Lineage between nodes MUST be
represented as typed, many-to-many edges pointing from the new node to the
existing node(s) it depends on. §6.2 requires these edges to be the only
persisted lineage representation (no mutable `children`).

### 7.2 Transformation Contract and Semantic-Change Taxonomy

Every Transformation record (`schemas/artifact/transformation.schema.json`)
MUST include the fields listed in `PROMPT.md`'s Transformation Contract:
`transformation_id`, `mode`, `actor`, `inputs`, `outputs`,
`semantic_change_claim`, `assumptions`, `ambiguities`, `alternatives`,
`rationale`, `confidence_assessments`, `uncertainties`, `evidence`,
`verification_results`, `applicable_policy`, `approval_requirement`.

`mode` MUST be exactly one of `preservation` or `discovery` (Core Principle
4). The `semantic_change_claim.classification` MUST be one of:

| Classification            | Meaning                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `exact-preservation`      | The output is claimed equivalent to the input under a cited equivalence procedure. |
| `clarification`           | The output restates the input's meaning without narrowing or changing it.          |
| `constraint-refinement`   | The output adds or tightens a constraint consistent with the input.                |
| `assumption-introduction` | The output relies on a new stated assumption not present in the input.             |
| `alternative-proposal`    | The output is offered as a candidate alternative, not yet adopted.                 |
| `intent-challenge`        | The output disputes or challenges the input's stated intent.                       |
| `semantic-modification`   | The output changes the meaning of the input.                                       |

A classification is an **attributed claim**, identifying the actor who
made it, not an automatically established fact. `exact-preservation` MAY
be treated as mechanically verified only when the transformation names an
applicable equivalence procedure with a corresponding Verification Report:
byte identity, canonical structural equality (e.g., AST equivalence),
reproducible-build evidence, or a cited formal proof (§13). A natural
language equivalence claim MUST instead identify an assessor, an
assessment method, supporting evidence, a confidence assessment, and a
dispute status — it MUST NOT be presented as mechanically proven.

Policy (§12) MUST require approval for any transformation whose
`semantic_change_claim.classification` is `semantic-modification` when
`subject` is part of an effective intent baseline. Policy MAY require
approval for other classifications. Whether approval is required is always
a policy **evaluation** result, computed against the current policy
version and the transformation's declared classification — never a
mutable boolean field on the transformation record itself.

### 7.3 Intent Authority and Revision

A conforming implementation MUST distinguish:

- **root intent** — the immutable Genesis-event-originated Intent artifact
  version that begins an intent lineage.
- **proposed intent** — an Intent artifact version submitted but not yet
  selected as effective by the applicable authority policy.
- **effective intent** — the Intent artifact version an authority policy
  currently designates as the approved baseline for a project or branch.
  Exactly one Intent version MAY be effective per (project, branch) at a
  time.
- **intent revision** — a new immutable Intent version whose lineage names
  the version it revises. Revising MUST NOT overwrite the revised version.
- **superseded intent** — a formerly effective Intent version, retained
  unmodified in history once a new version becomes effective.
- **merged intent** — an Intent version whose lineage names two or more
  prior branch-tip Intent versions and whose payload records how the
  reconciliation was performed.

Concurrent or conflicting Intent revisions (two proposed revisions of the
same parent, or two proposals to make different versions effective) MUST
result in a branch, not a silent pick. An **authority policy**
(`schemas/policy/authority-policy.schema.json`) — itself versioned — MUST
define who may select, merge, or supersede an effective Intent, and
whether quorum or separation-of-duties applies to that action. Until an
authority-policy-satisfying event resolves a conflict, the conflict MUST
remain visible as multiple candidate branch tips; no implementation may
select a winner by write order or timestamp.

Drift assessment (comparing an artifact or Intent to a baseline) MUST
identify its comparison target as exactly one of: the immediate parent
version (explains a single revision), the current effective baseline
(assesses implementation fidelity), or the root intent (exposes cumulative
historical change). A drift result that does not name its comparison
target is invalid per `schemas/verification/drift-assessment.schema.json`.

## 8. Approval and Accountability

### 8.1 Approval Decision

An Approval Decision is a signed attestation bound to an exact subject
identifier and digest (§3), with the fields listed in `PROMPT.md`:
`decision_id`, `request_id`, `subject`, `decision`, `scope`, `reviewer`,
`reviewer_authority`, `policy_id`, `policy_version`, `conditions`,
`comments`, `issued_at`, `expires_at`, `supersedes`, `signature`.
`decision` MUST be exactly one of `approved`, `rejected`,
`changes_requested`.

### 8.2 Approval Lifecycle

The approval lifecycle state machine (formalized in
`spec/state-machines.md` §2 and `formal/` as `ApprovalLifecycle`) is:

```text
requested -> approved
requested -> rejected
requested -> changes_requested
requested -> cancelled
approved  -> expired
approved  -> revoked
approved  -> superseded
```

Every transition MUST be represented by a new signed event; no transition
may be expressed by mutating a prior Approval Decision record.

### 8.3 Approval Validity

Evaluating whether an approval is currently valid for a given action MUST
consider, jointly: the subject's exact digest match, the policy version
the approval was issued under versus the currently applicable policy
version, reviewer authority at issuance and at evaluation time, quorum
satisfaction, any stated conditions, expiry, the signing key's status,
revocation, supersession, and any required separation-of-duties
constraint. A new subject version (e.g., a revised artifact) MUST NOT
inherit an approval issued for a prior version unless the applicable
policy explicitly defines a narrow equivalence rule under which it does
(§7.2's `exact-preservation` machinery is the only sanctioned basis for
such a rule).

### 8.4 Accountability Assignments

Accountability (who is the proposer, author, reviewer, approver, executor,
operator, owner, or incident owner for a scope) MUST be modeled
independently of approval, through versioned Accountability Assignment
records with `scope`, `issuer`, `authority`, `start_time`, `end_time`, and
`status`. Documentation MUST state, and this specification states here,
that an ACT accountability record is a technical and organizational claim;
it does not itself determine legal liability.

## 9. Confidence

A Confidence Assessment (`schemas/artifact/confidence-assessment.schema.json`)
MUST contain: `dimension`, an integer `score` from 0 to 100 or the literal
`unassessed`, `assessor`, `method` and `method_version`, `evidence`
references, `calibration_context`, `timestamp`, and `rationale`.

Required dimensions: `semantic`, `requirement`, `architectural`,
`implementation`, `verification`, `runtime`, `source`.

An implementation MUST NOT compute a single universal aggregate confidence
score. A policy MAY define a named projection for one specific decision
(e.g., "release-readiness score"); such a projection MUST retain links to
every source assessment plus its formula, weights, thresholds, and the
policy version that defined it — it is a documented, inspectable
computation, not a black-box number.

Confidence MUST NOT automatically increase as an artifact passes through a
transformation; an increase MUST be independently assessed and evidenced.
The verification toolkit (§13, `spec/conformance.md`) MUST be able to
flag: missing required-dimension assessments, an increase unsupported by
new evidence, a stale assessment (older than a policy-defined staleness
window relative to a subsequent material change), conflicting assessments
for the same dimension and subject, and a policy-defined threshold
collapse (e.g., a projection crossing a decision threshold when its inputs
did not materially change).

## 10. Uncertainty

An Uncertainty record MUST include: `id`, `description`, `category`
(`known-unknown`, `assumption`, `speculation`, `residual-risk`, or
`human-input-required`), `source`, `introducing_transformation`,
`affected_artifacts`, `impact` and `likelihood` assessments, `owner`,
`status`, `resolution_criteria`, `inherited_from` references, and
`resolving_evidence_or_decision` (nullable until resolved).

An unresolved uncertainty on a transformation's input MUST propagate to
every output the transformation produces, by creating (or extending) an
Uncertainty record on each output that names the input record via
`inherited_from`, unless the transformation's record explicitly discharges
it with cited evidence. This specification does not require or permit an
implementation to claim it enumerates all unknowable facts; §10's
`residual-risk` category exists precisely to represent bounded, honestly
labeled residual unknown risk instead.

## 11. Evidence, Verification, and Challenges

### 11.1 Evidence

Evidence MUST be immutable or content-addressed, and MUST record: origin,
collection method, custody chain, media type, digest, sensitivity label,
and stated limitations.

### 11.2 Key Lifecycle

Actor/Key records MUST support: issuance, rotation (issuing a new Key ID
for the same actor without invalidating past signatures made while the old
key was active), expiry, compromise-flagging, and revocation. Verifying an
old signature MUST use the key's status **at signing time**, not its
current status, except that a `compromised` flag propagates backward per
the trust policy's configured grace-period rule (documented in
`docs/security-and-privacy-guide.md`), since a compromise discovered later
casts retroactive doubt.

### 11.3 Verification Results

A Verification Report MUST use a `result` of exactly `pass`, `fail`, or
`inconclusive`, and MUST identify: `verifier`, `method`, `method_version`,
`subject_digest`, `evidence`, `execution_environment`, `time`,
`confidence`, and `limitations`. It MUST remain independently reproducible
when its method permits reproduction (e.g., re-running a deterministic
test), and MUST say so when it does not (e.g., a human review).

Verification layers a conforming implementation MUST support at the
protocol level (i.e., have a schema and state machine for, whether or not
every layer ships an automated tool in a given implementation profile):
schema/structural, cryptographic/ledger-integrity, provenance/lineage,
semantic assessment, requirement coverage, architecture-policy,
implementation/build, behavior/test, runtime, human review, formal
verification, independent AI assessment, and adversarial verification.

Independent AI assessment results MUST identify: provider, model, model
version when available, prompt digest, tool configuration, sampling
parameters, and output digest. An implementation MUST NOT require an AI
verifier's private hidden reasoning as a condition of validity; it MUST
instead store a concise rationale and cited evidence.

### 11.4 Challenges

A Challenge is a first-class signed attestation identifying: the disputed
claim, the challenger, grounds, evidence, requested remedy, and resolution
status. Resolving a challenge MUST NOT delete the original disputed claim
— resolution is a new event that references the challenge and the
original claim, not a mutation of either.

## 12. Policy Evaluation

A Policy is a versioned, immutable document (`schemas/policy/*.schema.json`)
governing one of: authorization, approval requirements, retention,
verification requirements, or trust. Policy evaluation MUST be
deterministic: given the same policy version, subject, and graph state, it
MUST produce the same result. Whether an action requires approval, what
quorum applies, and whether a caller is authorized are always the output
of evaluating a specific, cited policy version against the current
request — never a cached or mutable flag stored on the subject.

## 13. Formal Model

`formal/` contains a machine-checkable model (see `spec/state-machines.md`
and `docs/formal-methods.md` for the toolchain and how to run it) covering,
at minimum: append-only receipt-chain integrity, immutable history,
acyclic lineage, approval-lifecycle safety (no reachable state authorizes
an action without a valid, non-expired, non-revoked, quorum-satisfying
approval), and prevention of an unauthorized effective-intent transition.

## 14. Federation

See `spec/federation.md` for the full normative federation model: ledger
identity, export/import bundle format, duplicate detection, partial-history
representation, trust-policy evaluation on import, and fork/equivocation
detection. Summary invariant: **federation MUST NOT depend on global
consensus or a universal total event order.** Each ledger's authority is
limited to its own receipt chain and its own trust policy's evaluation of
what it accepts.

## 15. Privacy

See `docs/security-and-privacy-guide.md` for the full normative privacy and
redaction model. Summary invariants: artifact content is separated from
immutable event metadata via a content descriptor; deletion (redaction or
cryptographic erasure) MUST NOT rewrite signed history — it appends a
signed deletion event and may destroy plaintext or a content-encryption
key while leaving the digest, deletion authorization, reason, time, and
resulting availability state (`available`, `redacted`, `erased`,
`unavailable`) intact and inspectable.

## 16. Versioning, Extension, and Conformance

### 16.1 Version Axes

Four version identifiers change independently (`docs/versioning.md`):
`protocol_version` (this document's version, e.g. `act/1.0`), schema
version (per-`$id` version segment under `schemas/`), API version (the
`/v1` path prefix), and implementation version (semantic version of a
specific SDK, service, or CLI build).

### 16.2 Compatibility

A conforming implementation reading an event with a newer, compatible
`protocol_version` (same major version) MUST preserve any fields it does
not understand rather than dropping them, so that they survive a
read-write round trip and remain available to an implementation that does
understand them. An implementation MUST reject, rather than reinterpret,
an event whose major protocol version it does not support.

### 16.3 Extensions

The `extensions` field on events and the extension points documented per
schema use collision-resistant, reverse-DNS-style namespaces (e.g.,
`com.example.act-ext.my-field`). Extension data MUST survive a read-write
round trip through a conforming implementation that does not understand
the extension. Registering an extension namespace or a new algorithm
follows the process in `GOVERNANCE.md`'s Standards Adoption section.

### 16.4 Unknown Data

A conforming implementation MUST NOT silently reinterpret unknown
normative data (an unrecognized `event_type`, artifact payload
discriminator, or enum value) as a known value. It MUST reject the event
(if authoring/validating) or flag it as unrecognized (if reading
historical data), and MUST NOT proceed as though the field were absent
when its presence changes required behavior.

### 16.5 Conformance

`spec/conformance.md` defines the Core, Cryptographic Integrity, Secure
Service, Federation, SDK, and Explorer conformance profiles and the
fixtures a claimant must pass to certify conformance to each.

## 17. Security Considerations

See `docs/threat-model.md` for the full structured threat model. This
specification's contribution to mitigating that threat model is: making
every trust decision explicit and versioned (§6.4, §12), separating
cryptographic facts from trust/authorization results (§4.5), requiring
recomputation of content-derived identifiers at trust boundaries (§3),
preventing algorithm downgrade (§4.4), and requiring immutable,
hash-chained history (§5.3) that makes tampering, rollback, and
equivocation detectable rather than merely inconvenient.

## 18. Privacy Considerations

See §15 and `docs/security-and-privacy-guide.md`. This specification does
not require any implementation to disclose artifact content by default;
transparency under Core Principle 6 applies to the existence and integrity
of metadata about a transformation, not to universal content disclosure.
