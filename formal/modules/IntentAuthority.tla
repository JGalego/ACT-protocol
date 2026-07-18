---- MODULE IntentAuthority ----
\* Models spec/state-machines.md section 4 (Intent Authority State) for a
\* single (project, branch) scope. The quorum/authority arithmetic itself
\* is unit-tested in packages/policy/src/__tests__/authority.test.ts; this
\* model checks the SEQUENCING invariant -- that selecting a new effective
\* version always, atomically, supersedes whichever version was previously
\* effective, so at most one is ever effective at a time.
EXTENDS Naturals, FiniteSets
CONSTANT Versions
VARIABLE status
vars == <<status>>

States == {"proposed", "effective", "superseded"}

Init == status = [v \in Versions |-> "proposed"]

\* An authority-policy-satisfying event selects `v` (currently proposed) as
\* effective; whichever version was previously effective (if any) is
\* superseded in the SAME transition -- this atomicity is the invariant
\* under test (see the negative control in formal/README.md, which drops
\* it and shows TLC catching two simultaneously effective versions).
SelectEffective(v) ==
  /\ status[v] = "proposed"
  /\ status' = [x \in Versions |->
                  IF x = v THEN "effective"
                  ELSE IF status[x] = "effective" THEN "superseded"
                  ELSE status[x]]

Next == \E v \in Versions : SelectEffective(v)
Spec == Init /\ [][Next]_vars

TypeOK == status \in [Versions -> States]

\* At most one Intent version is effective per (project, branch) at any
\* point in the event sequence (spec/semantic-model.md's EffectiveIntentSafety).
EffectiveIntentSafety == Cardinality({v \in Versions : status[v] = "effective"}) <= 1
====
