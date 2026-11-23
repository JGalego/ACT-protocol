---- MODULE ApprovalLifecycle ----
\* Models spec/state-machines.md section 2 for a single Approval Decision
\* record. Terminal states have no outgoing transition in this model,
\* which is itself the safety property under test (TerminalStable below).
EXTENDS Naturals
VARIABLE state
vars == <<state>>

States == {"requested", "approved", "rejected", "changes_requested",
           "cancelled", "expired", "revoked", "superseded"}
Terminal == {"rejected", "changes_requested", "cancelled", "expired", "revoked", "superseded"}

Init == state = "requested"

Approve        == state = "requested" /\ state' = "approved"
Reject         == state = "requested" /\ state' = "rejected"
RequestChanges == state = "requested" /\ state' = "changes_requested"
Cancel         == state = "requested" /\ state' = "cancelled"
Expire         == state = "approved"  /\ state' = "expired"
Revoke         == state = "approved"  /\ state' = "revoked"
Supersede      == state = "approved"  /\ state' = "superseded"

Next == Approve \/ Reject \/ RequestChanges \/ Cancel \/ Expire \/ Revoke \/ Supersede
Spec == Init /\ [][Next]_vars

TypeOK == state \in States

\* Once a decision reaches a terminal state, no further transition moves it
\* (spec: "no further transition event referencing it is valid").
TerminalStable == [](state \in Terminal => [](state \in Terminal))

\* NOTE: an earlier version also checked `OnlyApprovedAuthorizes`, defined as "Expire,
\* Revoke and Supersede are only enabled in `approved`". That restated the transition
\* guards above, so it could never fail. The property that matters -- that the
\* authorization decision never authorizes without a valid, current, non-revoked,
\* quorum-satisfying approval -- needs requests, several reviewers, a clock and the
\* algorithm itself, and is checked in ApprovalAuthorization.tla.
====
