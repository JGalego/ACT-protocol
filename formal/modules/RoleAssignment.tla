---- MODULE RoleAssignment ----
\* Accountability assignments as the source of authority roles (ADR 0011;
\* spec/ACT-1.0.md section 8.4; services/api/src/role-registry.ts and
\* semantics.ts `enforceIntentAuthority`).
\*
\* One principal, "adm", administers the tenant (the root of trust); everyone else
\* is an adversary who may try to grant roles, end or revive assignments, and
\* decide (select an effective intent) at any moment, while time passes and
\* assignments expire. A role is held only through an active, unexpired
\* assignment. The implementation's answer is compared, at every action, with the
\* rule the spec states; any difference is flagged.
\*
\* One boolean per safeguard; the shipped config turns all on, a mutant turns one off.
EXTENDS Naturals, FiniteSets

CONSTANTS Principals,       \* includes Admin
          Admin,
          Roles,            \* {"owner", "approver"}; "approver" is what the authority policy accepts
          Scopes,
          MaxAssignments,
          CheckIssuer,      \* a grant needs an administrator or an owner
          ScopedOwner,      \* an owner may grant only in a scope they own
          NoSelfGrant,      \* an owner may not grant to themselves
          HonourStatus,     \* an ended or revoked assignment confers nothing
          HonourExpiry,     \* an assignment past its end_time confers nothing
          TerminalFinal,    \* ended and revoked cannot become active again
          ReviseAuth        \* only the issuer, an administrator, an owner of the scope, or (to end) the assignee may change one

VARIABLES assignments,   \* set of records
          violation
vars == <<assignments, violation>>

Statuses == {"active", "ended", "revoked"}
Terminal == {"ended", "revoked"}

Rec(id, role, assignee, scope, issuer, status, expired) ==
  [id |-> id, role |-> role, assignee |-> assignee, scope |-> scope, issuer |-> issuer,
   status |-> status, expired |-> expired]

\* The rule: a role is held only through an active, unexpired assignment.
Active(a) == a.status = "active" /\ ~a.expired
\* What the implementation actually counts.
ImplActive(a) == (HonourStatus => a.status = "active") /\ (HonourExpiry => ~a.expired)

IdealOwns(x, s) == \E a \in assignments : a.assignee = x /\ a.role = "owner" /\ a.scope = s /\ Active(a)
ImplOwns(x, s, scoped) ==
  \E a \in assignments : a.assignee = x /\ a.role = "owner" /\ (scoped => a.scope = s) /\ ImplActive(a)

IdealCanGrant(i, x, s) == i = Admin \/ (IdealOwns(i, s) /\ i # x)
ImplCanGrant(i, x, s) ==
  \/ i = Admin
  \/ ~CheckIssuer
  \/ (ImplOwns(i, s, ScopedOwner) /\ (NoSelfGrant => i # x))

IdealCanChange(by, a, to) ==
  \/ by = Admin \/ by = a.issuer
  \/ (by = a.assignee /\ to = "ended")
  \/ IdealOwns(by, a.scope)
ImplCanChange(by, a, to) ==
  \/ ~ReviseAuth
  \/ by = Admin \/ by = a.issuer
  \/ (by = a.assignee /\ to = "ended")
  \/ ImplOwns(by, a.scope, TRUE)

Init ==
  /\ assignments = {}
  /\ violation = {}

Grant(i, x, r, s) ==
  /\ Cardinality(assignments) < MaxAssignments
  /\ ImplCanGrant(i, x, s)
  /\ assignments' = assignments \cup {Rec(Cardinality(assignments), r, x, s, i, "active", FALSE)}
  /\ violation' = violation \cup (IF IdealCanGrant(i, x, s) THEN {} ELSE {"UnauthorizedGrant"})

Change(by, a, to) ==
  /\ a \in assignments
  /\ to \in Terminal
  /\ (TerminalFinal => a.status = "active")        \* from a final state only if finality is not enforced
  /\ ImplCanChange(by, a, to)
  /\ assignments' = (assignments \ {a}) \cup {[a EXCEPT !.status = to]}
  /\ violation' = violation
       \cup (IF IdealCanChange(by, a, to) THEN {} ELSE {"UnauthorizedChange"})
       \cup (IF a.status \in Terminal THEN {"Revived"} ELSE {})

\* Reviving an ended or revoked assignment (only possible when finality is not enforced).
Revive(by, a) ==
  /\ ~TerminalFinal
  /\ a \in assignments /\ a.status \in Terminal
  /\ ImplCanChange(by, a, "active")
  /\ assignments' = (assignments \ {a}) \cup {[a EXCEPT !.status = "active"]}
  /\ violation' = violation \cup {"Revived"}

\* Time passes: the assignment's end_time elapses.
Expire(a) ==
  /\ a \in assignments /\ ~a.expired
  /\ assignments' = (assignments \ {a}) \cup {[a EXCEPT !.expired = TRUE]}
  /\ UNCHANGED violation

\* Someone selects an effective intent in scope s, which needs an authorized role ("approver") there.
Select(x, s) ==
  /\ \E a \in assignments : a.assignee = x /\ a.role = "approver" /\ a.scope = s /\ ImplActive(a)
  /\ violation' = violation \cup
       (IF \E a \in assignments : a.assignee = x /\ a.role = "approver" /\ a.scope = s /\ Active(a)
        THEN {} ELSE {"UnauthorizedDecision"})
  /\ UNCHANGED assignments

Next ==
  \/ \E i, x \in Principals, r \in Roles, s \in Scopes : Grant(i, x, r, s)
  \/ \E by \in Principals, a \in assignments, to \in Terminal : Change(by, a, to)
  \/ \E by \in Principals, a \in assignments : Revive(by, a)
  \/ \E a \in assignments : Expire(a)
  \/ \E x \in Principals, s \in Scopes : Select(x, s)

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ \A a \in assignments :
       a.role \in Roles /\ a.assignee \in Principals /\ a.scope \in Scopes
       /\ a.issuer \in Principals /\ a.status \in Statuses /\ a.expired \in BOOLEAN
  /\ violation \subseteq {"UnauthorizedGrant", "UnauthorizedChange", "Revived", "UnauthorizedDecision"}

\* Every grant was made by an administrator, or by someone who then held an active, unexpired
\* owner role for that scope and was not granting to themselves.
GrantsAuthorized == "UnauthorizedGrant" \notin violation

\* Only the issuer, an administrator, an owner of the scope, or the assignee (to end) changes an assignment.
ChangesAuthorized == "UnauthorizedChange" \notin violation

\* Ended and revoked assignments are final.
TerminalIsFinal == "Revived" \notin violation

\* An effective intent is selected only by someone holding an authorized role, active and
\* unexpired, at that moment: a revoked, ended or lapsed role decides nothing.
DecisionsAuthorized == "UnauthorizedDecision" \notin violation

\* Every non-administrator grant traces back through earlier owner grants to the administrator.
TracesToAdministrator ==
  \A a \in assignments :
    a.issuer = Admin
    \/ \E o \in assignments : o.id < a.id /\ o.assignee = a.issuer /\ o.role = "owner" /\ o.scope = a.scope
====
