---- MODULE ArtifactVersionLifecycle ----
\* Models spec/state-machines.md section 1: two orthogonal dimensions for
\* a single artifact version record -- lineage `state` (active/superseded)
\* and content `availability` (available/redacted/erased/unavailable).
\* TypeOK + terminal-state sanity only.
EXTENDS Naturals
VARIABLES state, availability
vars == <<state, availability>>

States == {"active", "superseded"}
Availabilities == {"available", "redacted", "erased", "unavailable"}

Init == state = "active" /\ availability = "available"

Revise == state = "active" /\ state' = "superseded" /\ UNCHANGED availability

Redact == availability = "available" /\ availability' = "redacted" /\ UNCHANGED state
Erase  == availability = "redacted"  /\ availability' = "erased"   /\ UNCHANGED state
MarkUnavailable == availability = "available" /\ availability' = "unavailable" /\ UNCHANGED state

Next == Revise \/ Redact \/ Erase \/ MarkUnavailable
Spec == Init /\ [][Next]_vars

TypeOK == state \in States /\ availability \in Availabilities

\* Availability never regresses from erased back to available (spec section 1).
NeverRegressesFromErased ==
  [](availability = "erased" => [](availability = "erased"))

\* superseded is terminal for this version's lineage state.
SupersededStable == [](state = "superseded" => [](state = "superseded"))
====
