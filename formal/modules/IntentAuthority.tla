---- MODULE IntentAuthority ----
\* Effective-intent authority for one (project, branch) scope
\* (spec/ACT-1.0.md section 7.3; spec/state-machines.md section 4;
\* services/api/src/semantics.ts `enforceIntentAuthority`;
\* packages/policy/src/authority.ts `evaluateAuthoritySelection`).
\*
\* The earlier version of this model checked only that selecting a version
\* supersedes the previous one. It never asked WHO may select, so the real bug
\* -- anyone could declare any version effective -- was outside what it could
\* express. This version models the authority rule itself:
\*
\*   - versions are proposed by actors, and competing proposals are just
\*     branches: nothing is effective until a selection event;
\*   - a selection event carries a set of signing actors and takes effect only if
\*     the authority policy is satisfied: enough DISTINCT signers who hold an
\*     authorized role, with the version's own proposer excluded under
\*     separation of duties;
\*   - selecting a version supersedes the previously effective one, atomically.
\*
\* Mutants remove one rule each. `SpecAuthorized` is stated independently of the
\* guards (as a set-comprehension) so a mutant cannot also weaken the check
\* that is supposed to catch it.
EXTENDS Naturals, FiniteSets

CONSTANTS Versions, Actors, Owners, Quorum,
          SeparationOfDuties,   \* policy: the proposer may not count toward their own selection
          CheckAuthority,       \* a selection needs a role-holding quorum
          CheckDuty,            \* the real guard honours separation of duties
          CheckDistinct,        \* quorum counts distinct actors (signers form a set already; kept for the quorum-of-one mutant)
          Supersede,            \* selecting a version supersedes the prior effective one
          NoAutoPick            \* a conflict is never resolved by write order

VARIABLES status, proposer, selected, signedBy
vars == <<status, proposer, selected, signedBy>>

None == "none"

Init ==
  /\ status = [v \in Versions |-> "unproposed"]
  /\ proposer = [v \in Versions |-> None]
  /\ selected = {}                   \* versions that have been through an authorized selection
  /\ signedBy = [v \in Versions |-> {}]

Propose(v, a) ==
  /\ status[v] = "unproposed"
  /\ status' = [status EXCEPT ![v] = IF NoAutoPick \/ \A x \in Versions : status[x] # "proposed"
                                      THEN "proposed" ELSE "effective"]
  /\ proposer' = [proposer EXCEPT ![v] = a]
  /\ UNCHANGED <<selected, signedBy>>

\* The policy as the SPEC states it: distinct signers holding an authorized role,
\* minus the proposer if separation of duties applies, at least Quorum of them.
SpecEligible(v, signers) ==
  {a \in signers : a \in Owners /\ ~(SeparationOfDuties /\ a = proposer[v])}
SpecAuthorized(v, signers) == Cardinality(SpecEligible(v, signers)) >= Quorum

\* The guard as implemented, with each rule optional.
GuardEligible(v, signers) ==
  {a \in signers : (~CheckAuthority \/ a \in Owners)
                   /\ ~(CheckDuty /\ SeparationOfDuties /\ a = proposer[v])}
GuardOK(v, signers) ==
  IF CheckAuthority THEN Cardinality(GuardEligible(v, signers)) >= Quorum
  ELSE signers # {}

SelectEffective(v, signers) ==
  /\ status[v] = "proposed"
  /\ GuardOK(v, signers)
  /\ status' = [x \in Versions |->
                  IF x = v THEN "effective"
                  ELSE IF status[x] = "effective" /\ Supersede THEN "superseded"
                  ELSE status[x]]
  /\ selected' = selected \cup {v}
  /\ signedBy' = [signedBy EXCEPT ![v] = signers]
  /\ UNCHANGED proposer

Next ==
  \/ \E v \in Versions, a \in Actors : Propose(v, a)
  \/ \E v \in Versions, S \in SUBSET Actors : SelectEffective(v, S)

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ status \in [Versions -> {"unproposed", "proposed", "effective", "superseded"}]
  /\ selected \subseteq Versions

\* At most one version is effective at a time.
EffectiveIntentSafety == Cardinality({v \in Versions : status[v] = "effective"}) <= 1

\* A version is effective only because an authorized selection event made it so:
\* competing proposals stay visible as branches until one is selected, and no
\* write order or timestamp picks a winner (spec section 7.3).
EffectiveOnlyBySelection == \A v \in Versions : status[v] = "effective" => v \in selected

\* Whenever a version becomes effective, the spec's authority rule held for its
\* signers: a quorum of distinct role-holders, the proposer excluded under SoD.
EffectiveRequiresAuthority ==
  \A v \in Versions : status[v] = "effective" => SpecAuthorized(v, signedBy[v])

\* A superseded version never becomes effective again without a new authorized selection.
NoUnauthorizedRevival ==
  [][\A v \in Versions : (status[v] = "superseded" /\ status'[v] = "effective")
        => SpecAuthorized(v, signedBy'[v])]_vars
====
