---- MODULE ApprovalAuthorization ----
\* Approval requests, decisions and the authorization decision built on them
\* (spec/ACT-1.0.md section 8; spec/state-machines.md section 2).
\*
\* Two things are checked together:
\*
\*  1. The WRITE-TIME lifecycle that services/api/src/semantics.ts enforces
\*     (`enforceApprovalLifecycle`): a decision needs an existing request, each
\*     reviewer decides a request once, only an approved decision can be revoked
\*     or can expire, a decided request cannot be cancelled, and an ended
\*     decision never comes back.
\*
\*  2. The AUTHORIZATION decision, `evaluateApprovalAuthorization`
\*     (packages/verification/src/authorization.ts), transcribed as `Impl`, is
\*     compared at every reachable state with `Spec`, an independent statement of
\*     spec section 8.3 written as an existential over *sets* of decisions rather
\*     than a filter-and-count. `ImplMatchesSpec` is the safety theorem: the
\*     algorithm authorizes exactly when the spec says it must, no more (never
\*     authorize without a valid, current, non-revoked, quorum-satisfying
\*     approval) and no less.
\*
\* The Impl* constants switch off one check of the real algorithm each; every
\* mutant in formal/mutants/ must break ImplMatchesSpec or NoInheritedApproval.
\* The same predicate is compared with the real TypeScript exhaustively in
\* packages/verification/src/__tests__/authorization.test.ts.
EXTENDS Naturals, FiniteSets

CONSTANTS Reviewers, Author, Eligible,   \* Eligible: reviewers whose role satisfies the policy
          Versions, Quorum, MaxTime,
          SeparationOfDuties,            \* policy flag
          ImplSubject,                   \* count only decisions on the exact subject version
          ImplState,                     \* count only decisions still in the `approved` state
          ImplExpiry,                    \* ignore decisions past their expiry
          ImplDistinct,                  \* count distinct reviewers, not decisions
          ImplDuty,                      \* exclude the author when separation of duties applies
          ImplRole,                      \* require an eligible role
          ImplVerdict                    \* count only `approved` verdicts

VARIABLES now,
          requests,     \* set of [id, subject, requester]
          decisions,    \* set of [id, request, reviewer, verdict, state, expires]
          cancelled,    \* set of request ids
          nextId
vars == <<now, requests, decisions, cancelled, nextId>>

Never == MaxTime + 1
Verdicts == {"approved", "rejected"}
States == {"approved", "rejected", "revoked", "expired"}

Init ==
  /\ now = 0
  /\ requests = {}
  /\ decisions = {}
  /\ cancelled = {}
  /\ nextId = 1

Tick == /\ now < MaxTime /\ now' = now + 1 /\ UNCHANGED <<requests, decisions, cancelled, nextId>>

RequestExists(r) == \E q \in requests : q.id = r
RequestOf(r) == CHOOSE q \in requests : q.id = r

Request(v, who) ==
  /\ Cardinality(requests) < 2
  /\ requests' = requests \cup {[id |-> nextId, subject |-> v, requester |-> who]}
  /\ nextId' = nextId + 1
  /\ UNCHANGED <<now, decisions, cancelled>>

\* Write-time rules: existing request, not cancelled, once per reviewer.
Decide(r, who, verdict, expires) ==
  /\ RequestExists(r) /\ r \notin cancelled
  /\ ~\E d \in decisions : d.request = r /\ d.reviewer = who
  /\ Cardinality(decisions) < 3
  /\ decisions' = decisions \cup
       {[id |-> nextId, request |-> r, reviewer |-> who, verdict |-> verdict,
         state |-> verdict, expires |-> expires]}
  /\ nextId' = nextId + 1
  /\ UNCHANGED <<now, requests, cancelled>>

\* Only a still-pending request, by its requester.
Cancel(r) ==
  /\ RequestExists(r) /\ r \notin cancelled
  /\ ~\E d \in decisions : d.request = r
  /\ cancelled' = cancelled \cup {r}
  /\ UNCHANGED <<now, requests, decisions, nextId>>

\* Only an approved decision, by the reviewer who made it.
Revoke(d) ==
  /\ d \in decisions /\ d.state = "approved"
  /\ decisions' = (decisions \ {d}) \cup {[d EXCEPT !.state = "revoked"]}
  /\ UNCHANGED <<now, requests, cancelled, nextId>>

\* Only an approved decision whose expiry has elapsed.
Expire(d) ==
  /\ d \in decisions /\ d.state = "approved" /\ d.expires <= now
  /\ decisions' = (decisions \ {d}) \cup {[d EXCEPT !.state = "expired"]}
  /\ UNCHANGED <<now, requests, cancelled, nextId>>

Next ==
  \/ Tick
  \/ \E v \in Versions, w \in Reviewers : Request(v, w)
  \/ \E r \in 1..2, w \in Reviewers, vd \in Verdicts, x \in {1, Never} : Decide(r, w, vd, x)
  \/ \E r \in 1..2 : Cancel(r)
  \/ \E d \in decisions : Revoke(d)
  \/ \E d \in decisions : Expire(d)

Spec == Init /\ [][Next]_vars

\* ------------------------------------------------- the authorization decision
SubjectOf(d) == RequestOf(d.request).subject
Authored(r) == RequestOf(r).requester     \* the author whose work is being approved

\* Spec section 8.3 / state-machines section 2: a decision individually counts iff
\* it is an approval, is still in the approved state, has not expired, is by an
\* eligible reviewer, on the exact subject, and (separation of duties) not by the author.
Counts(d, v) ==
  /\ d.verdict = "approved"
  /\ d.state = "approved"
  /\ d.expires > now
  /\ d.reviewer \in Eligible
  /\ SubjectOf(d) = v
  /\ (SeparationOfDuties => d.reviewer # Author)

\* The spec predicate, as an existential over a SET of decisions: some set of
\* individually-counting decisions has at least Quorum distinct reviewers.
SpecAuthorized(v) ==
  \E S \in SUBSET decisions :
      /\ \A d \in S : Counts(d, v)
      /\ Cardinality({d.reviewer : d \in S}) >= Quorum

\* The implementation, transcribed: filter, then count distinct reviewers.
\* Each Impl* flag removes one of its filters.
ImplCounted(v) ==
  {d \in decisions :
      /\ (~ImplVerdict \/ d.verdict = "approved")
      /\ (~ImplState \/ d.state = "approved")
      /\ (~ImplExpiry \/ d.expires > now)
      /\ (~ImplRole \/ d.reviewer \in Eligible)
      /\ (~ImplSubject \/ SubjectOf(d) = v)
      /\ (~ImplDuty \/ ~SeparationOfDuties \/ d.reviewer # Author)}

ImplAuthorized(v) ==
  IF ImplDistinct
  THEN Cardinality({d.reviewer : d \in ImplCounted(v)}) >= Quorum
  ELSE Cardinality(ImplCounted(v)) >= Quorum

TypeOK ==
  /\ now \in 0..MaxTime
  /\ decisions \subseteq [id : Nat, request : Nat, reviewer : Reviewers, verdict : Verdicts,
                          state : States, expires : Nat]

\* Write-time: every decision names an existing request.
DecisionHasRequest == \A d \in decisions : RequestExists(d.request)

\* Write-time: a reviewer decides a request at most once.
ReviewerDecidesOnce ==
  \A d, e \in decisions : (d.request = e.request /\ d.reviewer = e.reviewer) => d = e

\* A cancelled request never has a decision (cancel needs "still pending", decide needs "not cancelled").
CancelledStaysUndecided == \A r \in cancelled : ~\E d \in decisions : d.request = r

\* THE THEOREM: the algorithm authorizes exactly when the spec predicate holds.
ImplMatchesSpec == \A v \in Versions : ImplAuthorized(v) <=> SpecAuthorized(v)

\* No version is ever authorized by approvals that were given for another version.
NoInheritedApproval ==
  \A v \in Versions : ImplAuthorized(v) => (\E q \in requests : q.subject = v)

\* An ended decision never becomes approved again.
EndedIsTerminal ==
  [][\A d \in decisions : d.state \in {"revoked", "expired", "rejected"}
        => \A e \in decisions' : e.id = d.id => e.state = d.state]_vars
====
