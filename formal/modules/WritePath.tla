---- MODULE WritePath ----
\* An adversarial model of the ledger write path's *attribution* and *key*
\* rules (spec/ACT-1.0.md sections 4.5, 6.1 and 11.2; ADR 0009), covering
\* packages/ledger/src/ledger.ts `appendEvent` steps 3-4 and
\* services/api/src/key-registry.ts `evaluateKeyEvent`.
\*
\* Principals each hold exactly one private key and one public key; both are
\* named by the principal. `Corrupt` principals are controlled by an adversary
\* who may sign anything with their keys, register keys, revoke, and submit any
\* event he can build. Honest principals only ever sign events naming
\* themselves. A key id is a *label* for a registry entry; a signature carries
\* the label it claims and the principal that really produced it, and verifies
\* iff the registry's public key for that label is the producer's. This is how
\* the real verifier works (it looks the public key up by key id), and it is
\* what makes a key-id takeover an attack: re-pointing a label re-aims every
\* later signature check.
\*
\* The BIND* / NO* constants switch each real guard on or off. The checked-in
\* configurations turn them all on and TLC finds nothing; each mutant in
\* formal/mutants/ turns exactly one off and TLC must find the matching
\* violation (see formal/README.md, "Non-vacuity").
EXTENDS FiniteSets

CONSTANTS Principals, Corrupt,
          BindKeyId,       \* key id must be the fingerprint of its public key
          NoOverwrite,     \* an existing key id cannot be re-bound
          BindOwner,       \* only a key's owner may register it
          BindSigner,      \* the claimed actor key must be among the signers
          BindActor,       \* the claimed actor key must belong to the claimed actor
          CheckStatus,     \* a revoked key may not author events
          CheckCosigners,  \* every co-signing key must itself be trusted
          RevokeAuth,      \* a key may only be revoked by a trusted key of the same owner
          GenesisOwner     \* a genesis may not take over an artifact someone else created

Honest == Principals \ Corrupt
\* A registry slot with no key. A record of the same shape as an entry, so that
\* comparing a slot with `None` is always a comparison of like types.
None == [pub |-> "none", owner |-> "none", status |-> "none"]
NoCreator == "none"
Artifacts == {"a1"}
NoArtifact == "none"

Sig == [label : Principals, by : Principals]
Event == [actor : Principals, actorLabel : Principals,
          sigs : SUBSET Sig, artifact : Artifacts \cup {NoArtifact}]

VARIABLES reg, creator, honestSigned, violation
vars == <<reg, creator, honestSigned, violation>>

Entry == [pub : Principals, owner : Principals, status : {"active", "revoked"}]

\* Events an honest principal h signs: itself as actor, its own key, only its own signature.
HonestEvents ==
  {[actor |-> h, actorLabel |-> h, sigs |-> {[label |-> h, by |-> h]}, artifact |-> x] :
      h \in Honest, x \in Artifacts \cup {NoArtifact}}

Init ==
  /\ reg = [l \in Principals |-> None]
  /\ creator = [a \in Artifacts |-> NoCreator]
  /\ honestSigned = {}
  /\ violation = {}

\* ---------------------------------------------------------------- registry
\* POST /v1/keys, registration. The sender proves possession by signing with
\* the private key of the public key it presents.
RegisterKey(sender, label, pub, owner) ==
  /\ pub \in (IF sender \in Corrupt THEN Corrupt ELSE {sender})
  /\ (sender \in Honest => (label = sender /\ pub = sender /\ owner = sender))
  /\ BindKeyId => label = pub
  /\ BindOwner => owner = sender
  /\ NoOverwrite => reg[label] = None
  /\ LET old == reg[label]
         new == [pub |-> pub, owner |-> owner, status |-> "active"]
     IN /\ old # new
        /\ reg' = [reg EXCEPT ![label] = new]
        /\ violation' = violation
             \cup (IF old # None /\ (old.pub # pub \/ old.owner # owner)
                   THEN {"KeyBindingChanged"} ELSE {})
             \cup (IF old # None /\ old.status = "revoked"
                   THEN {"RevokedKeyResurrected"} ELSE {})
  /\ UNCHANGED <<creator, honestSigned>>

\* A status change: `sender` signs with a key registered under `signerLabel`.
RevokeKey(sender, signerLabel, target) ==
  /\ reg[signerLabel] # None /\ reg[target] # None
  /\ reg[signerLabel].pub = sender
  /\ reg[signerLabel].status = "active"
  /\ (sender \in Honest => target = sender)
  /\ RevokeAuth => reg[signerLabel].owner = reg[target].owner
  /\ reg[target].status = "active"
  /\ reg' = [reg EXCEPT ![target].status = "revoked"]
  /\ violation' = violation
       \cup (IF reg[signerLabel].owner # reg[target].owner
             THEN {"UnauthorizedRevocation"} ELSE {})
  /\ UNCHANGED <<creator, honestSigned>>

\* ------------------------------------------------------------------ events
HonestSign(e) ==
  /\ e \in HonestEvents
  /\ honestSigned' = honestSigned \cup {e}
  /\ UNCHANGED <<reg, creator, violation>>

SigValid(s) == reg[s.label] # None /\ reg[s.label].pub = s.by

\* What the adversary can put on the wire: an honest-signed event verbatim
\* (replay), or any event whose signatures all come from keys he controls.
Submittable == honestSigned \cup {e \in Event : \A s \in e.sigs : s.by \in Corrupt}

Accept(e) ==
  /\ e \in Submittable
  /\ e.sigs # {}                                          \* at least one signature
  /\ \A s \in e.sigs : SigValid(s)                        \* every signature verifies
  /\ reg[e.actorLabel] # None                             \* the claimed key is known
  /\ BindSigner => \E s \in e.sigs : s.label = e.actorLabel
  /\ BindActor => reg[e.actorLabel].owner = e.actor
  /\ CheckStatus => reg[e.actorLabel].status = "active"
  \* Every signer *other than* the actor key (that one is judged by CheckStatus,
  \* mirroring the trust-policy check on the actor key vs. the co-signer loop).
  /\ CheckCosigners => \A s \in e.sigs : s.label # e.actorLabel => reg[s.label].status = "active"
  /\ (e.artifact # NoArtifact /\ GenesisOwner)
       => (creator[e.artifact] = NoCreator \/ creator[e.artifact] = e.actor)
  /\ creator' = IF e.artifact = NoArtifact THEN creator
                ELSE IF creator[e.artifact] = NoCreator
                     THEN [creator EXCEPT ![e.artifact] = e.actor]
                     ELSE creator
  /\ violation' = violation
       \cup (IF e.actor \in Honest /\ ~(\E s \in e.sigs : s.by = e.actor)
             THEN {"ForgedAttribution"} ELSE {})
       \cup (IF \E s \in e.sigs \cup {[label |-> e.actorLabel, by |-> e.actor]} :
                  reg[s.label].status = "revoked"
             THEN {"RevokedKeyAccepted"} ELSE {})
       \cup (IF e.artifact # NoArtifact /\ creator[e.artifact] # NoCreator
                /\ creator[e.artifact] # e.actor
             THEN {"ArtifactTakeover"} ELSE {})
  /\ UNCHANGED <<reg, honestSigned>>

Next ==
  \/ \E s, l, p, o \in Principals : RegisterKey(s, l, p, o)
  \/ \E s, l, t \in Principals : RevokeKey(s, l, t)
  \/ \E e \in HonestEvents : HonestSign(e)
  \/ \E e \in Event : Accept(e)

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ reg \in [Principals -> Entry \cup {None}]
  /\ creator \in [Artifacts -> Principals \cup {NoCreator}]
  /\ honestSigned \subseteq HonestEvents
  /\ violation \subseteq {"ForgedAttribution", "KeyBindingChanged", "RevokedKeyResurrected",
                          "UnauthorizedRevocation", "RevokedKeyAccepted", "ArtifactTakeover"}

\* An accepted event never names an honest actor unless that actor signed it.
NoForgedAttribution == "ForgedAttribution" \notin violation
\* A key id, once bound to a public key and owner, is never re-bound.
KeyBindingStable == "KeyBindingChanged" \notin violation
\* A revoked key is never brought back by re-registration.
NoResurrection == "RevokedKeyResurrected" \notin violation
\* Only a trusted key of the same owner can revoke a key.
OnlyOwnerRevokes == "UnauthorizedRevocation" \notin violation
\* No event is accepted under a key that has been revoked.
NoRevokedKeyAccepted == "RevokedKeyAccepted" \notin violation
\* An artifact's lineage is never taken over by a different actor's genesis.
NoArtifactTakeover == "ArtifactTakeover" \notin violation
====
