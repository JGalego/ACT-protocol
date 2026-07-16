# ACT Semantic Model

Status: Normative, companion to `spec/ACT-1.0.md`.

This document defines the entities `ACT-1.0.md` references and the
relations between them. It is expressed as typed entities and relations
rather than as code; `schemas/` is the executable JSON Schema
serialization of the same model, and `formal/` is the machine-checked
subset of its invariants.

## 1. Entities

| Entity                    | Immutable?                                        | Identified by                                 | Defined in          |
| ------------------------- | ------------------------------------------------- | --------------------------------------------- | ------------------- |
| Intent                    | Yes, per version                                  | artifact-version ID                           | ACT-1.0.md §7.3     |
| Interpretation            | Yes, per version                                  | artifact-version ID                           | §2 below            |
| Artifact                  | Yes, per version                                  | artifact-version ID                           | ACT-1.0.md §7.1, §8 |
| Transformation            | Yes                                               | transformation_id (event-derived)             | ACT-1.0.md §7.2     |
| Revision                  | Yes                                               | artifact-version ID (of the revising version) | ACT-1.0.md §7.3     |
| Evidence                  | Yes, or content-addressed                         | digest                                        | ACT-1.0.md §11.1    |
| Approval                  | Yes, per decision                                 | decision_id                                   | ACT-1.0.md §8       |
| Authorization             | Derived (policy evaluation result)                | n/a — a computed result, not a stored fact    | ACT-1.0.md §12      |
| Accountability Assignment | Yes, per version                                  | assignment ID                                 | ACT-1.0.md §8.4     |
| Confidence Assessment     | Yes                                               | assessment ID                                 | ACT-1.0.md §9       |
| Uncertainty               | Yes, per version (status changes via new version) | uncertainty ID                                | ACT-1.0.md §10      |
| Verification              | Yes                                               | report ID                                     | ACT-1.0.md §11.3    |
| Validation                | Derived (schema/structural pass-fail)             | n/a                                           | schemas/            |
| Provenance                | Derived (a traversal of typed edges)              | n/a                                           | ACT-1.0.md §7.1     |
| Challenge                 | Yes                                               | challenge ID                                  | ACT-1.0.md §11.4    |
| Policy                    | Yes, per version                                  | policy_id + policy_version                    | ACT-1.0.md §12      |
| Actor                     | Stable identity, versioned key bindings           | actor_id                                      | ACT-1.0.md §11.2    |
| Identity                  | see Actor                                         | n/a                                           | ACT-1.0.md §11.2    |
| Key                       | Immutable once issued                             | key_id                                        | ACT-1.0.md §11.2    |
| Event                     | Immutable                                         | event_id                                      | ACT-1.0.md §5.1     |
| Receipt                   | Immutable                                         | ledger_id + sequence                          | ACT-1.0.md §5.3     |
| Ledger                    | Append-only                                       | ledger_id                                     | ACT-1.0.md §6       |

## 2. Interpretation

**Interpretation** is the entity that makes ACT's "semantic conclusions
inspectable and attributable" (Objective, `PROMPT.md`). An Interpretation
is an attributed reading of an Intent or Artifact's meaning, produced by
exactly one of: a deterministic structural/normalized-text assessor, an
AI-based assessor, or a human assessor (`spec/ACT-1.0.md` §11.3,
"semantic assessment" verification layer). An Interpretation is never
itself the ground truth of what an Intent "really means" — it is one
assessor's claim, with a method, confidence, and dispute status, over
which a Challenge (§11.4) may be raised. Multiple, possibly conflicting,
Interpretations of the same Intent version MAY coexist; ACT does not
resolve them to a single meaning except where an authority policy (§7.3)
designates one as the basis for an approval decision.

## 3. Relations

```text
Actor          --authors-->            Event
Actor          --owns-->               Key            (versioned binding)
Event          --creates/updates-->    Artifact | Transformation | Attestation | Policy
Transformation --consumes(input)-->    Artifact (version)
Transformation --produces(output)-->   Artifact (version)
Transformation --claims-->             semantic_change_claim (Interpretation, attributed)
Transformation --carries-->            Confidence Assessment*, Uncertainty*, Evidence*
Artifact       --revises-->            Artifact (prior version)        [Revision]
Artifact       --instance_of-->        Intent | Goal | ... | Actor | Key  [Artifact Type]
Approval       --authorizes-->         (subject artifact-version, exact digest)
Approval       --issued_under-->       Policy (version)
Approval       --decided_by-->         Actor (reviewer), with reviewer_authority
Accountability --assigns-->            Actor -> role, over a scope and time window
Challenge      --disputes-->           Attestation | Artifact | Transformation
Verification   --evaluates-->          (subject digest)
Evidence       --supports-->           Attestation | Verification
Ledger         --issues-->             Receipt (chained to previous receipt)
Receipt        --accepts-->            Event
```

## 4. Core Invariants (cross-reference to `formal/`)

1. **Acyclic lineage**: the subgraph of lineage-typed edges (Transformation
   input/output, Revision parent, Merge parents) is acyclic. Modeled as
   `AcyclicLineage` in `formal/`.
2. **Append-only receipt integrity**: a ledger's receipt sequence, once
   issued, is never reordered, deleted, or mutated. Modeled as
   `ReceiptChainIntegrity`.
3. **Immutable history**: an accepted Event's canonical payload never
   changes; corrections are new Events. Modeled as `ImmutableHistory`.
4. **Approval lifecycle safety**: no reachable protocol state treats an
   action as authorized without a currently valid Approval Decision
   satisfying policy, quorum, and non-expiry/non-revocation. Modeled as
   `ApprovalLifecycleSafety`.
5. **Effective-intent transition safety**: an Intent version becomes
   effective only via an event that an authority policy sanctions; no
   concurrent conflicting transition both succeeds. Modeled as
   `EffectiveIntentSafety`.

See `spec/state-machines.md` for the state machines these invariants
constrain and `formal/README.md` for how to execute the model checker.
