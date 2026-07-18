---- MODULE ChallengeLifecycle ----
\* Models spec/state-machines.md section 3. TypeOK + terminal-state sanity
\* only -- this state machine carries none of the five Definition-of-Done
\* invariants, so it isn't modeled in the same depth as
\* ApprovalLifecycle/IntentAuthority.
EXTENDS Naturals
VARIABLE state
vars == <<state>>

States == {"open", "resolved_upheld", "resolved_rejected", "resolved_remedied"}
Terminal == {"resolved_upheld", "resolved_rejected", "resolved_remedied"}

Init == state = "open"

Uphold == state = "open" /\ state' = "resolved_upheld"
Reject == state = "open" /\ state' = "resolved_rejected"
Remedy == state = "open" /\ state' = "resolved_remedied"

Next == Uphold \/ Reject \/ Remedy
Spec == Init /\ [][Next]_vars

TypeOK == state \in States
TerminalStable == [](state \in Terminal => [](state \in Terminal))
====
