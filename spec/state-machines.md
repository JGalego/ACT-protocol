# ACT State Machines

Status: Normative, companion to `spec/ACT-1.0.md`. Machine-readable definitions of these state machines live in `formal/state-machines/*.json` and are consumed by the TLA+ model in `formal/` and by `packages/verification`'s lifecycle checks.

Every transition below is effected by exactly one new signed Event; no transition is a mutation of an existing record.

## 1. Artifact Version Lifecycle

```text
              +-----------+
   Genesis -->|  active   |
              +-----------+
                 |     |
        revise() |     | redact()/erase()
                 v     v
          +-----------+   +--------------+
          | superseded|   | availability:|
          +-----------+   | redacted/    |
                           | erased       |
                           +--------------+
```

- `active`: the version exists, its content availability is `available` (or `inline`/`referenced` per storage), and no newer revision has been recorded for its lineage tip.
- `superseded`: a `Revision` event named a newer version as the tip of this lineage. `superseded` is orthogonal to content availability — a superseded version's content MAY still be `available`.
- Availability (`available` -> `redacted` -> `erased`, or `available` -> `unavailable`) is tracked independently per §15 of `ACT-1.0.md`; it never regresses from `erased` back to `available`.

## 2. Approval Lifecycle

```text
requested --approve()-->            approved
requested --reject()-->              rejected
requested --request_changes()-->     changes_requested
requested --cancel()-->               cancelled
approved  --[expires_at elapses]-->   expired
approved  --revoke()-->                revoked
approved  --[new approval supersedes]--> superseded
```

Invariants (checked in `formal/`, model `ApprovalLifecycle`):

- `rejected`, `cancelled`, `expired`, `revoked`, and `superseded` are terminal for that Approval Decision record; no further transition event referencing it is valid except a Challenge.
- `changes_requested` is terminal for that decision but does not block a new Approval Request from being opened for a revised subject.
- An `approved` decision only authorizes an action while it is in the `approved` state AND every joint condition in `ACT-1.0.md` §8.3 holds (matching subject digest, non-revoked key, satisfied quorum, etc.).

## 3. Challenge Lifecycle

```text
open --uphold()-->     resolved_upheld     (disputed claim stands; challenge closed)
open --reject()-->     resolved_rejected   (challenge found without merit)
open --remedy()-->     resolved_remedied   (a new event addresses the grounds)
```

A Challenge never causes deletion of the original disputed claim (per `ACT-1.0.md` §11.4); `resolved_remedied` links to the remediating event without altering the original.

## 4. Intent Authority State (per project/branch)

```text
(no effective intent) --select(root)--> effective
effective --revise()--> effective is unchanged; a new `proposed` version exists
proposed  --[authority policy selects]--> becomes effective; prior effective -> superseded
proposed  --[conflicting proposal, no resolving event]--> branched (both remain proposed/tips)
branched  --[authority-policy-sanctioned merge or selection]--> effective (one version), others -> superseded
```

Invariant `EffectiveIntentSafety` (`formal/`): at most one Intent version is `effective` per (project, branch) at any point in the event sequence, and a version transitions to `effective` only via an event whose actor and policy context satisfy the applicable authority policy's quorum/authority rule evaluated at that point in the sequence.

## 5. Key Lifecycle

```text
issued --activate()--> active
active --rotate()--> rotated       (superseding key issued; this key's *future* signing is invalid,
                                     past signatures remain verifiable against its status at signing time)
active --expire()--> expired
active --revoke()--> revoked
active --flag_compromised()--> compromised
```

`rotated`, `expired`, `revoked`, and `compromised` all mean "do not accept new signatures from this key" but are recorded distinctly because they carry different implications for past-signature validity (`ACT-1.0.md` §11.2): a `compromised` flag MAY retroactively cast doubt on signatures made shortly before detection (per the configured grace-period trust-policy rule), while `expired` and `rotated` do not.

## 6. Ledger Receipt Chain (per ledger)

```text
(genesis constant) --append(event_0)--> receipt_0 { sequence: 0, previous_receipt_digest: genesis_constant }
receipt_n --append(event_n+1)--> receipt_n+1 { sequence: n+1, previous_receipt_digest: digest(receipt_n) }
```

Invariant `ReceiptChainIntegrity` (`formal/`): for every `n > 0`, `receipt_n.previous_receipt_digest == digest(receipt_{n-1})`, and `sequence` is strictly increasing by exactly 1 with no gaps within one ledger's chain.
