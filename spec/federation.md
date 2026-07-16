# ACT Federation

Status: Normative, companion to `spec/ACT-1.0.md` §14.

## 1. Model

ACT federation is peer-to-peer between independently operated ledgers.
There is no global sequencer, no universal event order, and no ledger with
inherent authority over another (Core Principle 7). Each ledger:

- has its own `ledger_id` and its own hash-chained receipt sequence
  (`spec/ACT-1.0.md` §5.3, §6)
- decides, via its own versioned trust policy, which actors/keys and which
  peer ledgers it accepts events from
- issues its own receipt for every event it accepts, whether locally
  authored or imported, and never rewrites a receipt it imported from
  another ledger

Causal order is established solely by `causal_parents` links between
events, never by comparing `occurred_at` or by assuming a shared clock
across ledgers.

## 2. Bundle Format

A **signed event bundle** (`schemas/federation/bundle.schema.json`) is the
unit of export/import. It contains:

```yaml
bundle_id: # content digest of the canonical bundle body
source_ledger_id:
exported_at: # exporting ledger's clock claim
events: # array of { signed_envelope, source_receipt }
completeness: # "complete" | "partial", plus a description of what's excluded
  scope: # e.g. artifact_id list, time range, or "full history"
  known_gaps: # explicit list of causal_parents referenced but not included
signature: # exporting ledger's signature over the bundle body
```

Export MUST include, for every included event, the **source receipt**
issued by the exporting ledger (or, if re-exporting, the receipt chain
provenance needed to show the event's original acceptance), so that an
importer can verify the event was genuinely accepted by the claimed source
at the claimed sequence, not fabricated at export time.

## 3. Import Algorithm

On receiving a bundle, the importing ledger MUST, per event, in the
bundle's `causal_parents`-respecting topological order:

1. Verify the bundle signature and every per-event signature (§4.5 of
   `ACT-1.0.md` — all six results computed, none skipped).
2. Recompute the event ID and content digests; reject on mismatch
   (quarantine, see §4).
3. Evaluate its own trust policy against the event's actor/key and the
   bundle's source ledger. An event MAY pass cryptographic checks and
   still fail trust-policy evaluation — this MUST be reported as a
   trust-policy failure, not a cryptographic one.
4. Deduplicate: if an event with this event ID is already accepted (from
   this or any other source), the import of that event is a no-op that
   does not create a duplicate receipt or duplicate projection state.
5. Check causal parents: if a named parent is not present in the
   destination ledger's history and not included earlier in this bundle,
   the event is accepted only if the bundle's `completeness` is `partial`
   and the gap is listed in `known_gaps`; the resulting local view of that
   lineage MUST be marked as having an explicit missing-parent boundary
   (§14.3 below) rather than silently treated as complete.
6. Check for cycles the import would introduce against the destination's
   existing graph; reject the specific offending event(s) into quarantine,
   not the whole bundle, unless the bundle's own internal ordering is
   contradictory.
7. Append the source receipt as preserved history and issue the importing
   ledger's own new receipt for the import event.

## 4. Quarantine

Events that fail step 1, 2, 3, or 6 above MUST be placed in a quarantine
store: retained (for audit and dispute resolution) but excluded from
projections and from lineage/verification results as if absent, with an
explained finding recording why each was quarantined. Quarantine MUST NOT
silently drop events — an operator MUST be able to list quarantined events
and their rejection reasons.

## 5. Partial History

A destination ledger's view of an imported lineage MAY be incomplete by
design (§3 step 5). This MUST be represented explicitly: a lineage query
result that includes a boundary where a `causal_parents` entry is
unresolved MUST report that boundary (which event, which missing parent)
rather than reporting the lineage as complete. `spec/ACT-1.0.md` Required
Acceptance Scenario 9 requires this to be automatically tested.

## 6. Fork and Equivocation Detection

A **fork** is two or more events both naming the same single parent as
their sole immediate predecessor in a context where the model (e.g.,
effective-intent selection, §7.3) expects at most one accepted successor;
forks are legitimate (branches) unless the applicable authority policy
says otherwise, and are surfaced, not hidden.

**Equivocation** is a stronger, adversarial signal: the same actor and key
signing two structurally conflicting events over the same subject digest
and same immediate causal context (e.g., the same reviewer issuing two
different `approved` decisions for the same exact subject digest under the
same policy version, contradicting each other), which is evidence of key
misuse or a malicious/compromised actor rather than of ordinary concurrent
work. A conforming implementation MUST be able to detect and flag
equivocation as a distinct finding class from an ordinary branch, using
immutable identities and the causal-lineage graph (never wall-clock
order) to establish the conflict.

## 7. What Federation Does Not Require

Federation in ACT explicitly does not require, and implementations MUST
NOT assume: a single global event order, a shared/synchronized clock
across ledgers, mutual real-time availability (import is inherently
asynchronous and offline-capable), or a universally trusted ledger
operator. Any of these, if present, is a deployment choice layered on top
of ACT, not a protocol requirement.
