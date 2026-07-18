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

\* An approved decision is the only state from which "authorizes an
\* action" (modeled here as the ability to fire Expire/Revoke/Supersede --
\* the transitions this spec says only an approved decision permits) holds.
OnlyApprovedAuthorizes ==
  [](ENABLED Expire \/ ENABLED Revoke \/ ENABLED Supersede => state = "approved")
====
