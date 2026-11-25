# ADR 0012: Key Trust on Import Is Judged at the Source's Acceptance Time

## Status

Accepted. Amends ADR 0009 (trust was evaluated at import time).

## Context

ADR 0009 recorded a conservative limitation: when a bundle is imported, every event is checked against the key registry _as it stands now_. An event signed while its key was active is therefore refused (quarantined) if that key has since been rotated or revoked locally, even though the source ledger accepted it legitimately. The reverse also matters: a key revoked locally at time _R_ must not authorize an event the source accepted _after_ _R_ in the peer's view.

The ADR deferred a fix because "evaluating at the original signing time needs a trustworthy signing time, which `occurred_at` is not." That is true: `occurred_at` is claimed by the signer, so a holder of a revoked key could simply claim an earlier time.

Each event carries the source ledger's signed receipt, including `accepted_at`. Import verifies that receipt against the operator's pinned ledger key (ADR 0009), so the event signer cannot choose its acceptance timestamp.

## Decision

**Time for an imported event is its source receipt's `accepted_at`.** The trust checks in the ledger's write path for an event that arrives with a source receipt, for the actor key and for every co-signing key, ask whether the key was valid for signing _at that time_, not whether it is valid now. A native event is still judged at the moment it is accepted. `occurred_at` is never consulted.

**Key history records attested time.** A key's history (`KeyRegistry`) is a list of status changes, each stamped with the time its event was accepted by the ledger that first accepted it: the local acceptance time for a native event, the source receipt's `accepted_at` for an imported one. Key validity at a time uses the existing `evaluateKeyValidityAt` rules: a key did not exist before its first recorded status; `rotated`, `expired` and `revoked` end signing from their effective time but do not retroactively invalidate earlier signatures; `compromised` invalidates signatures within the grace window before it was recorded (24 hours by default).

**Key events in a bundle are judged the same way.** A key registration or status change inside a bundle is vetted at its own source acceptance time (for a status change: whether the signing key was trusted then). The registry replays them in log order, so the live registry and a rebuild agree.

**Consequences for the two cases that motivated this.** An event the source accepted while the key was active is imported even if the key was revoked locally afterwards. An event the source accepted at or after a local revocation is refused, which is the protection revocation exists to give. Because revocation takes effect at a ledger-attested time, there is no way to move an event across it by choosing a timestamp.

**Clocks.** Source acceptance times are compared with local key-history times. Clock skew can place an event on either side of a revocation incorrectly. Operators should account for that window. The 24-hour compromise grace window applies to compromise, not ordinary revocation.

**Out of scope.** The CLI's workspace trust (`act key trust`) is an explicit local allow-list with no key history, so it keeps judging at import time. Authority roles (ADR 0011) are evaluated when a decision is accepted, not re-evaluated for imported decisions.

## Verification

`formal/modules/ImportTrustTime.tla` models a key that is registered, then revoked or compromised at a nondeterministic time, and imports of events with every combination of source acceptance time and signer-claimed time at every later moment. It checks that no event is imported unless the key was valid at its attested time and that no valid event is refused. Mutants evaluate at import time, at the claimed time, ignore revocation, and drop the compromise grace window; TLC must break each. A ledger test, an API test over two real ledgers with a real revocation between the events, and removing each rule from the code check the implementation.

## Consequences

- Legitimate history stays importable after later key retirement, and revoked keys still cannot authorize anything the source accepted after the revocation.
- Key history now mixes timestamps from different ledgers; each entry's time is the one attested by whoever first accepted it.
- Operators get one more documented residual risk (clock skew between ledgers) in exchange for removing a limitation that quarantined valid history.
