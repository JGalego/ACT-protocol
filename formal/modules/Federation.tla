---- MODULE Federation ----
\* Importing events from a peer ledger across an untrusted network
\* (spec/ACT-1.0.md section 14; spec/federation.md sections 3-5;
\* services/api/src/bundle-ops.ts `importBundle` and
\* packages/ledger/src/bundle.ts).
\*
\* The local ledger has pinned ONE peer, S, out of band. S is honest: it only
\* ever exports events it really accepted, signed under its pinned key. The
\* adversary controls the network and a ledger of his own, M. He can forward a
\* genuine bundle, tamper with one (so its id no longer matches its body),
\* forge a bundle signed under his own key, or present a bundle from M carrying
\* events S never accepted -- including a perfectly self-consistent bundle from
\* M with M's own valid signature and receipts. He cannot produce S's signature.
\*
\* Events form a chain e1 <- e2 <- e3 (each is the child of the previous); a
\* bundle may omit the parent of an event it contains, and must then DECLARE
\* that gap. Importing is event by event, so a child can arrive before its
\* parent; the boundary must be recorded when it does and cleared when the
\* parent arrives.
\*
\* Mutants remove one check each.
EXTENDS Naturals, FiniteSets

CONSTANTS Events,              \* the ids S may genuinely accept
          Forged,              \* ids the adversary invents (S never accepted them)
          PinnedPeer,          \* "S"
          CheckPeer,           \* the bundle must name a registered, pinned ledger
          CheckBundleDigest,   \* bundle_id must be the digest of the body
          CheckBundleSig,      \* the bundle must be signed by the pinned key
          CheckGaps            \* a missing parent is accepted only if the bundle declares it

VARIABLES srcAccepted,   \* what S has genuinely accepted
          local,         \* what the local ledger has accepted
          boundary,      \* recorded missing-parent boundaries: set of <<child, parent>>
          violation
vars == <<srcAccepted, local, boundary, violation>>

Ledgers == {"S", "M"}

\* e1 has no parent; e2's parent is e1; e3's is e2; a forged event's parent is e1.
ParentOf(e) ==
  CASE e = "e1" -> "none"
    [] e = "e2" -> "e1"
    [] e = "e3" -> "e2"
    [] OTHER    -> "e1"
HasParent(e) == ParentOf(e) # "none"

AllIds == Events \cup Forged

\* A bundle as it arrives: who it says it is from, which events it carries, whether its
\* id matches its body, who signed it, and which parents it declares missing.
Bundle == [src : Ledgers, ids : SUBSET AllIds, intact : BOOLEAN,
           signedBy : Ledgers, declared : SUBSET AllIds]

Init ==
  /\ srcAccepted = {}
  /\ local = {}
  /\ boundary = {}
  /\ violation = {}

\* S accepts the next event of its chain (parents first, as a ledger must).
SourceAccepts(e) ==
  /\ e \in Events /\ e \notin srcAccepted
  /\ (HasParent(e) => ParentOf(e) \in srcAccepted)
  /\ srcAccepted' = srcAccepted \cup {e}
  /\ UNCHANGED <<local, boundary, violation>>

\* What the adversary can deliver. A genuine bundle from S carries only events S
\* accepted, intact, signed by S. Everything else he can build is signed by M.
\* (He can also drop events from a genuine bundle, and tamper with one -- which
\* leaves it signed by S but no longer intact.)
Deliverable(b) ==
  \/ /\ b.src = "S" /\ b.signedBy = "S" /\ b.intact /\ b.ids \subseteq srcAccepted
  \/ /\ b.src = "S" /\ b.signedBy = "S" /\ ~b.intact /\ b.ids \subseteq AllIds
  \/ /\ b.signedBy = "M"

\* Importing one event of a delivered bundle.
Import(b, e) ==
  /\ Deliverable(b) /\ e \in b.ids
  /\ e \notin local
  /\ (CheckPeer => b.src = PinnedPeer)
  /\ (CheckBundleDigest => b.intact)
  /\ (CheckBundleSig => b.signedBy = PinnedPeer)
  /\ LET p == ParentOf(e)
         missing == HasParent(e) /\ p \notin local
     IN /\ (CheckGaps /\ missing) => p \in b.declared
        /\ local' = local \cup {e}
        /\ boundary' = (boundary \cup (IF missing THEN {<<e, p>>} ELSE {}))
                       \ {pair \in boundary : pair[2] = e}      \* e arrives: its children's boundaries clear
        /\ violation' = violation
             \cup (IF e \notin srcAccepted THEN {"Forged"} ELSE {})
             \cup (IF missing /\ p \notin b.declared THEN {"UndeclaredGap"} ELSE {})
  /\ UNCHANGED srcAccepted

Next ==
  \/ \E e \in Events : SourceAccepts(e)
  \/ \E b \in Bundle, e \in AllIds : Import(b, e)

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ srcAccepted \subseteq Events
  /\ local \subseteq AllIds
  /\ violation \subseteq {"Forged", "UndeclaredGap"}

\* The local ledger only ever holds events the pinned, honest source really accepted.
NoForgedEvents == "Forged" \notin violation

\* A missing parent is accepted only where the bundle declared the gap.
NoUndeclaredGaps == "UndeclaredGap" \notin violation

\* The recorded boundaries are exactly the (child, missing parent) pairs that exist:
\* none stale after a parent arrives, none absent while a parent is missing.
BoundaryAccurate ==
  boundary = {<<e, ParentOf(e)>> : e \in {x \in local : HasParent(x) /\ ParentOf(x) \notin local}}
====
