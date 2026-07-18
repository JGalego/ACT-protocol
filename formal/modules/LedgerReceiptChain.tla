---- MODULE LedgerReceiptChain ----
\* Models spec/state-machines.md section 6 (Ledger Receipt Chain) and the
\* ReceiptChainIntegrity invariant from spec/semantic-model.md section 4.
\* Mirrors packages/ledger/src/ledger.ts's appendEvent: each accepted event
\* gets exactly one receipt, chained to the previous receipt's digest, with
\* a strictly incrementing sequence number.
EXTENDS Naturals, Sequences, FiniteSets
CONSTANT EventIds
VARIABLES receipts, history

Last(s) == s[Len(s)]
\* Abstraction: a receipt's "digest" is modeled as the receipt record itself
\* rather than a real SHA-256 hash -- this model checks the CHAINING
\* invariant (structural integrity of the sequence), not the cryptographic
\* digest algorithm itself, which packages/core's real digest tests cover.
Digest(r) == r

vars == <<receipts, history>>

Init ==
  /\ receipts = <<>>
  /\ history = [id \in EventIds |-> "UNWRITTEN"]

\* One event is submitted and durably appended, atomically (ledger.ts's
\* appendEvent is a single all-or-nothing transaction).
Submit(id) ==
  /\ history[id] = "UNWRITTEN"
  /\ history' = [history EXCEPT ![id] = "WRITTEN"]
  /\ LET prevDigest == IF receipts = <<>> THEN "GENESIS" ELSE Digest(Last(receipts))
     IN receipts' = Append(receipts, [sequence |-> Len(receipts), event_id |-> id,
                                       previous_receipt_digest |-> prevDigest])

Next == \E id \in EventIds : Submit(id)
Spec == Init /\ [][Next]_vars /\ WF_vars(Next)

TypeOK ==
  /\ history \in [EventIds -> {"UNWRITTEN", "WRITTEN"}]
  /\ \A i \in DOMAIN receipts : receipts[i].sequence = i - 1

\* spec/semantic-model.md section 4: every receipt after the first correctly
\* chains to its predecessor's digest, and sequence numbers are contiguous.
ReceiptChainIntegrity ==
  \A i \in 2..Len(receipts) :
    /\ receipts[i].previous_receipt_digest = Digest(receipts[i - 1])
    /\ receipts[i].sequence = receipts[i - 1].sequence + 1

\* An event, once written, is never un-written -- history is immutable.
ImmutableHistory ==
  [][\A id \in EventIds : history[id] = "WRITTEN" => history'[id] = "WRITTEN"]_vars
====
