---- MODULE KeyLifecycle ----
\* Models spec/state-machines.md section 5. TypeOK + terminal-state sanity
\* only. The retroactive-doubt semantics of a compromised flag
\* (ACT-1.0.md section 11.2) are pure-function-tested (no state machine)
\* in packages/crypto/src/__tests__/key-lifecycle.test.ts.
EXTENDS Naturals
VARIABLE state
vars == <<state>>

States == {"issued", "active", "rotated", "expired", "revoked", "compromised"}
Terminal == {"rotated", "expired", "revoked", "compromised"}

Init == state = "issued"

Activate       == state = "issued" /\ state' = "active"
Rotate         == state = "active" /\ state' = "rotated"
Expire         == state = "active" /\ state' = "expired"
Revoke         == state = "active" /\ state' = "revoked"
FlagCompromised == state = "active" /\ state' = "compromised"

Next == Activate \/ Rotate \/ Expire \/ Revoke \/ FlagCompromised
Spec == Init /\ [][Next]_vars

TypeOK == state \in States
TerminalStable == [](state \in Terminal => [](state \in Terminal))
====
