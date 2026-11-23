---- MODULE ImportTrustTime ----
\* Judging an imported event's signing key at the source ledger's acceptance time
\* (ADR 0012; packages/ledger/src/ledger.ts step 4, services/api/src/key-registry.ts).
\*
\* One key is registered and may later be revoked, or flagged compromised, on the
\* importing ledger at a moment the model chooses. A pinned, honest source ledger
\* accepted events signed by it at attested times s. Whoever holds the key
\* chooses the time the event *claims* (occurred_at, c) freely. At any later
\* moment the event may be offered to the importing ledger. The rule says: import
\* it exactly when the key was valid for signing at the attested time s.
\*
\* Each import compares what the implementation decides with what the rule
\* decides; a wrong import is a security failure, a wrong refusal quarantines
\* legitimate history. Mode selects the implementation under test:
\*   "attested"   the shipped rule
\*   "importTime" judged at the moment of import
\*   "claimed"    judged at the signer-claimed time
\*   "ignore"     revocation and compromise ignored
\*   "noGrace"    compromise treated like revocation (no retroactive window)
EXTENDS Naturals

CONSTANTS Mode,          \* one of the strings above
          MaxTime,
          RegisteredAt,  \* when the key first existed (per the source's registration)
          Grace          \* how long before a compromise was recorded signatures are distrusted

VARIABLES now,           \* local clock
          status,        \* "active" | "revoked" | "compromised"
          statusAt,      \* when the status last changed (attested)
          violation
vars == <<now, status, statusAt, violation>>

Times == 0..MaxTime

Init ==
  /\ now = 0
  /\ status = "active"
  /\ statusAt = 0
  /\ violation = {}

Tick == /\ now < MaxTime /\ now' = now + 1 /\ UNCHANGED <<status, statusAt, violation>>

Revoke ==
  /\ status = "active" /\ now >= RegisteredAt
  /\ status' = "revoked" /\ statusAt' = now
  /\ UNCHANGED <<now, violation>>

Compromise ==
  /\ status = "active" /\ now >= RegisteredAt
  /\ status' = "compromised" /\ statusAt' = now
  /\ UNCHANGED <<now, violation>>

\* The rule: was the key valid for signing at time t?
ValidAt(t) ==
  /\ t >= RegisteredAt
  /\ \/ status = "active"
     \/ (status = "revoked" /\ t < statusAt)
     \/ (status = "compromised" /\ t + Grace < statusAt)

\* What the implementation under test decides for an event with attested time s and claimed time c.
ImplAccepts(s, c) ==
  CASE Mode = "attested"   -> ValidAt(s)
    [] Mode = "importTime" -> status = "active" /\ now >= RegisteredAt
    [] Mode = "claimed"    -> ValidAt(c)
    [] Mode = "ignore"     -> s >= RegisteredAt
    [] Mode = "noGrace"    -> /\ s >= RegisteredAt
                              /\ \/ status = "active"
                                 \/ (status # "active" /\ s < statusAt)

\* An event accepted by the source at s (s cannot be in the future), offered now.
Offer(s, c) ==
  /\ s <= now
  /\ violation' = violation
       \cup (IF ImplAccepts(s, c) /\ ~ValidAt(s) THEN {"ImportedWhenInvalid"} ELSE {})
       \cup (IF ~ImplAccepts(s, c) /\ ValidAt(s) THEN {"RefusedWhenValid"} ELSE {})
  /\ UNCHANGED <<now, status, statusAt>>

Next ==
  \/ Tick \/ Revoke \/ Compromise
  \/ \E s \in Times, c \in Times : Offer(s, c)

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ now \in Times /\ status \in {"active", "revoked", "compromised"} /\ statusAt \in Times
  /\ violation \subseteq {"ImportedWhenInvalid", "RefusedWhenValid"}

\* Nothing is imported unless its key was valid when the source accepted it.
NoInvalidImport == "ImportedWhenInvalid" \notin violation

\* Nothing legitimate is refused just because the key was retired later.
NoValidRefused == "RefusedWhenValid" \notin violation
====
