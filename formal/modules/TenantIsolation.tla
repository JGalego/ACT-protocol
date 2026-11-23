---- MODULE TenantIsolation ----
\* Tenants sharing one deployment (ADR 0010; spec/ACT-1.0.md section 6.5;
\* services/api/src/ledger-context.ts `TenantRegistry`, packages/ledger storage
\* scoping, services/api/src/tenancy.ts).
\*
\* Every tenant is an adversary against every other. Each can register keys,
\* submit events that name any tenant, any key and any parent, read, list its
\* peers, administer (if an administrator), pin peers and import bundles. The
\* store is shared; what keeps tenants apart is whether each lookup is scoped to
\* the caller's own ledger. Each action computes the answer the implementation
\* would give and the answer the tenant would get if it were alone on the server
\* (the "ideal"). Any difference is information from another tenant: an
\* existence oracle, a count, a conflict.
\*
\* One boolean per safeguard; the shipped config turns them all on, and a mutant
\* turns exactly one off.
EXTENDS Naturals, FiniteSets

CONSTANTS Tenants, Ids, Keys, Actors,
          GlobalAdmins,      \* bare ACT_ADMIN_ACTORS entries: administrators in whichever tenant their token names
          ScopedAdmins,      \* `tenant::actor` entries, all for the one tenant AdminTenant
          AdminTenant,
          ScopedEvents,      \* duplicate detection looks only inside the caller's ledger
          ScopedReads,       \* reads look only inside the caller's ledger
          ScopedParents,     \* a causal parent must exist in the caller's ledger
          ScopedKeys,        \* the key registry is per ledger
          CheckClaim,        \* a native event must state the caller's tenant
          PerLedgerSeq,      \* each ledger has its own receipt sequence
          ScopedMeta,        \* peers (metadata) are namespaced per tenant
          ScopedAdmin,       \* a `tenant::actor` administrator is one only in that tenant
          CheckPin           \* a bundle is imported only from a peer pinned in the caller's tenant

VARIABLES accepted,     \* accepted[t]: records the ledger of tenant t holds
          registered,   \* registered[t]: keys in t's key registry
          peerStore,    \* the shared metadata table: set of <<namespace, peerId>>
          ownPeers,     \* ownPeers[t]: the peers t really registered (the ideal answer to "list peers")
          pinned,       \* pinned[t]: tenants whose ledger t's administrators have pinned
          violation
vars == <<accepted, registered, peerStore, ownPeers, pinned, violation>>

Claims == Tenants \cup {"na"}                   \* "na": not_applicable
Parents == {"none"} \cup Ids
PeerId == "p"

\* A signed event as it reaches a tenant, and the record a ledger stores for it.
Record(id, key, claim, parent, imp) ==
  [id |-> id, key |-> key, claim |-> claim, parent |-> parent, imp |-> imp]

IdsOf(S) == {r.id : r \in S}

RECURSIVE SumCard(_)
SumCard(S) == IF S = {} THEN 0
              ELSE LET t == CHOOSE x \in S : TRUE IN Cardinality(accepted[t]) + SumCard(S \ {t})

AllAccepted == UNION {accepted[t] : t \in Tenants}
AllRegistered == UNION {registered[t] : t \in Tenants}

\* What each lookup consults. Scoped: only the caller's own ledger. Unscoped: the whole table.
EventScope(t)  == IF ScopedEvents  THEN accepted[t] ELSE AllAccepted
ReadScope(t)   == IF ScopedReads   THEN accepted[t] ELSE AllAccepted
ParentScope(t) == IF ScopedParents THEN accepted[t] ELSE AllAccepted
KeyScope(t)    == IF ScopedKeys    THEN registered[t] ELSE AllRegistered
Namespace(t)   == IF ScopedMeta    THEN t ELSE "*"

\* The administrator predicate (isAdministrator in tenancy.ts), and what it should say.
ImplAdmin(t, a) == a \in GlobalAdmins \/ (a \in ScopedAdmins /\ (~ScopedAdmin \/ t = AdminTenant))
IdealAdmin(t, a) == a \in GlobalAdmins \/ (a \in ScopedAdmins /\ t = AdminTenant)

Init ==
  /\ accepted = [t \in Tenants |-> {}]
  /\ registered = [t \in Tenants |-> {}]
  /\ peerStore = {}
  /\ ownPeers = [t \in Tenants |-> {}]
  /\ pinned = [t \in Tenants |-> {}]
  /\ violation = {}

\* A tenant registers a key. A key id already in *its own* registry is a conflict it may
\* learn about; one that exists only in another tenant's registry must look new.
Register(t, k) ==
  /\ LET refused == k \in KeyScope(t)
         ideal   == k \in registered[t]
     IN /\ registered' = IF refused THEN registered
                         ELSE [registered EXCEPT ![t] = @ \cup {k}]
        /\ violation' = violation \cup (IF refused # ideal THEN {"Oracle"} ELSE {})
  /\ UNCHANGED <<accepted, peerStore, ownPeers, pinned>>

\* A tenant submits a native event: any key, any claimed tenant, any parent.
Submit(t, id, k, claim, parent) ==
  /\ k \in KeyScope(t)                                         \* signer trusted (trust policy)
  /\ (CheckClaim => claim = t)                                 \* event names this ledger's tenant
  /\ (parent # "none" => parent \in IdsOf(ParentScope(t)))     \* causal parent exists
  /\ LET duplicate == id \in IdsOf(EventScope(t))
         idealDup  == id \in IdsOf(accepted[t])
         idealParent == parent = "none" \/ parent \in IdsOf(accepted[t])
         seqSeen  == IF PerLedgerSeq THEN Cardinality(accepted[t]) ELSE SumCard(Tenants)
         seqIdeal == Cardinality(accepted[t])
     IN /\ accepted' = IF duplicate THEN accepted
                       ELSE [accepted EXCEPT ![t] = @ \cup {Record(id, k, claim, parent, FALSE)}]
        /\ violation' = violation
             \cup (IF duplicate # idealDup THEN {"Oracle"} ELSE {})
             \cup (IF ~idealParent THEN {"Oracle"} ELSE {})
             \cup (IF ~duplicate /\ seqSeen # seqIdeal THEN {"Oracle"} ELSE {})
  /\ UNCHANGED <<registered, peerStore, ownPeers, pinned>>

\* A tenant reads an event id.
Read(t, id) ==
  /\ violation' = violation \cup (IF (id \in IdsOf(ReadScope(t))) # (id \in IdsOf(accepted[t]))
                                  THEN {"Oracle"} ELSE {})
  /\ UNCHANGED <<accepted, registered, peerStore, ownPeers, pinned>>

\* An administrator registers a peer; the store keeps it under a namespace.
AddPeer(t, a) ==
  /\ ImplAdmin(t, a)
  /\ peerStore' = peerStore \cup {<<Namespace(t), PeerId>>}
  /\ ownPeers' = [ownPeers EXCEPT ![t] = @ \cup {PeerId}]
  /\ violation' = violation \cup (IF ~IdealAdmin(t, a) THEN {"AdminEscalation"} ELSE {})
  /\ UNCHANGED <<accepted, registered, pinned>>

\* A tenant lists its peers.
ListPeers(t) ==
  /\ LET listed == {p \in {s[2] : s \in peerStore} : <<Namespace(t), p>> \in peerStore}
     IN violation' = violation \cup (IF listed # ownPeers[t] THEN {"Oracle"} ELSE {})
  /\ UNCHANGED <<accepted, registered, peerStore, ownPeers, pinned>>

\* An administrator pins another tenant's ledger as a federation peer.
Pin(t, a, u) ==
  /\ ImplAdmin(t, a) /\ u # t
  /\ pinned' = [pinned EXCEPT ![t] = @ \cup {u}]
  /\ violation' = violation \cup (IF ~IdealAdmin(t, a) THEN {"AdminEscalation"} ELSE {})
  /\ UNCHANGED <<accepted, registered, peerStore, ownPeers>>

\* Importing an event that tenant u's ledger holds into t's ledger, as a bundle would
\* carry it: it keeps its authoring tenant's claim and is marked imported.
Import(t, u, r) ==
  /\ u # t /\ r \in accepted[u] /\ ~r.imp
  /\ (CheckPin => u \in pinned[t])
  /\ r.id \notin IdsOf(accepted[t])
  /\ accepted' = [accepted EXCEPT ![t] = @ \cup {Record(r.id, r.key, r.claim, "none", TRUE)}]
  /\ violation' = violation \cup (IF u \notin pinned[t] THEN {"UnpinnedImport"} ELSE {})
  /\ UNCHANGED <<registered, peerStore, ownPeers, pinned>>

Next ==
  \/ \E t \in Tenants, k \in Keys : Register(t, k)
  \/ \E t \in Tenants, id \in Ids, k \in Keys, c \in Claims, p \in Parents :
        id # p /\ Submit(t, id, k, c, p)
  \/ \E t \in Tenants, id \in Ids : Read(t, id)
  \/ \E t \in Tenants, a \in Actors : AddPeer(t, a)
  \/ \E t \in Tenants : ListPeers(t)
  \/ \E t \in Tenants, a \in Actors, u \in Tenants : Pin(t, a, u)
  \/ \E t \in Tenants, u \in Tenants, r \in AllAccepted : Import(t, u, r)

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ \A t \in Tenants : accepted[t] \subseteq [id : Ids, key : Keys, claim : Claims, parent : Parents, imp : BOOLEAN]
  /\ \A t \in Tenants : registered[t] \subseteq Keys
  /\ violation \subseteq {"Oracle", "AdminEscalation", "UnpinnedImport"}

\* Whatever a tenant can observe (a duplicate, a read, a parent lookup, a sequence
\* number, a key conflict, a peer list) is exactly what it would observe alone.
ResponsesIndependent == "Oracle" \notin violation

\* Every natively submitted event in a ledger was signed by a key in that ledger's own
\* registry: no tenant's key is trusted in another tenant.
NoCrossTenantTrust ==
  \A t \in Tenants : \A r \in accepted[t] : ~r.imp => r.key \in registered[t]

\* Every natively submitted event in a ledger names that ledger's tenant.
EventsNameTheirTenant ==
  \A t \in Tenants : \A r \in accepted[t] : ~r.imp => r.claim = t

\* Only an administrator of tenant t (scoped to t, or unscoped) administers t.
AdminsAreTenantScoped == "AdminEscalation" \notin violation

\* A ledger holds an imported event only if its administrators pinned the source.
ImportsOnlyFromPinnedPeers == "UnpinnedImport" \notin violation
====
