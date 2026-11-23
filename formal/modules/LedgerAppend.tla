---- MODULE LedgerAppend ----
\* Concurrent, crashing appends to one ledger (spec/ACT-1.0.md section 6.1 and
\* 5.3; packages/ledger/src/ledger.ts `appendEvent`, the `StorageAdapter.withTransaction`
\* contract, and postgres-adapter.ts's optimistic retry).
\*
\* Several workers submit events at once. Each runs the real sequence: the
\* duplicate check (OUTSIDE the transaction), then a transaction that reads a
\* REPEATABLE READ snapshot, computes `next sequence = MAX+1` and the previous
\* receipt digest from that snapshot, and commits. Two workers can therefore
\* compute the same sequence from the same snapshot; the database's uniqueness
\* constraints are what turn that race into one winner and one retry. A worker
\* may also crash at any moment, losing its local state.
\*
\* A receipt's "digest" is modelled as the receipt record itself (a perfect
\* hash): this model checks the *chaining discipline*, not SHA-256, which the
\* conformance vectors cover.
\*
\* Mutants (formal/mutants/LedgerAppend.*.cfg) remove one safeguard each.
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS Workers, MaxAttempts,
          UniqueSeq,                  \* UNIQUE (ledger_id, sequence) on events/receipts
          UniqueEvent,                \* event_id is a primary key
          Atomic                      \* event row + receipt row are written in ONE transaction

VARIABLES log,        \* committed receipts, in sequence order
          rows,       \* committed event rows (a set of event ids)
          pc, snap, staged, attempts, mid
vars == <<log, rows, pc, snap, staged, attempts, mid>>

\* Workers w1 and w2 submit the same event (a client retry racing its original);
\* w3 submits a different one. (Cfg files cannot give function-valued constants.)
Submits == [w \in Workers |-> IF w = "w3" THEN "e2" ELSE "e1"]

GENESIS == "GENESIS"

Receipt(seq, ev, prev) == [seq |-> seq, event |-> ev, prev |-> prev]
Digest(r) == r
PrevOf(s) == IF s = <<>> THEN GENESIS ELSE Digest(s[Len(s)])
Committed(ev) == ev \in rows

Init ==
  /\ log = <<>>
  /\ rows = {}
  /\ pc = [w \in Workers |-> "idle"]
  /\ snap = [w \in Workers |-> <<>>]
  /\ staged = [w \in Workers |-> [seq |-> 0, event |-> "none", prev |-> GENESIS]]
  /\ attempts = [w \in Workers |-> 0]
  /\ mid = [w \in Workers |-> FALSE]

\* Step "duplicate check by event id": outside the transaction, so it can be stale.
DupCheck(w) ==
  /\ pc[w] = "idle"
  /\ IF Committed(Submits[w])
     THEN pc' = [pc EXCEPT ![w] = "done"]            \* idempotent: existing receipt returned
     ELSE pc' = [pc EXCEPT ![w] = "check-passed"]
  /\ UNCHANGED <<log, rows, snap, staged, attempts, mid>>

\* BEGIN ISOLATION LEVEL REPEATABLE READ: the worker sees a snapshot of the log.
Begin(w) ==
  /\ pc[w] = "check-passed"
  /\ snap' = [snap EXCEPT ![w] = log]
  /\ attempts' = [attempts EXCEPT ![w] = @ + 1]
  /\ pc' = [pc EXCEPT ![w] = "begun"]
  /\ UNCHANGED <<log, rows, staged, mid>>

\* nextSequence() and the previous-receipt read, both from the snapshot.
Compute(w) ==
  /\ pc[w] = "begun"
  /\ staged' = [staged EXCEPT ![w] = Receipt(Len(snap[w]), Submits[w], PrevOf(snap[w]))]
  /\ pc' = [pc EXCEPT ![w] = "computed"]
  /\ UNCHANGED <<log, rows, snap, attempts, mid>>

SeqTaken(r) == \E i \in 1..Len(log) : log[i].seq = r.seq

Conflict(r) ==
  \/ (UniqueSeq /\ SeqTaken(r))
  \/ (UniqueEvent /\ Committed(r.event))

\* A lost race: the transaction rolls back and the worker retries from the top
\* (which re-runs the duplicate check) or gives up with a storage conflict.
Abort(w) ==
  /\ pc' = [pc EXCEPT ![w] = IF attempts[w] < MaxAttempts THEN "idle" ELSE "failed"]
  /\ UNCHANGED <<log, rows, snap, staged, attempts, mid>>

\* COMMIT. With Atomic the event row and the receipt row appear together.
Commit(w) ==
  /\ pc[w] = "computed"
  /\ IF Conflict(staged[w])
     THEN Abort(w)
     ELSE IF Atomic
          THEN /\ log' = Append(log, staged[w])
               /\ rows' = rows \cup {Submits[w]}
               /\ pc' = [pc EXCEPT ![w] = "done"]
               /\ UNCHANGED <<snap, staged, attempts, mid>>
          ELSE /\ rows' = rows \cup {Submits[w]}      \* event row first ...
               /\ mid' = [mid EXCEPT ![w] = TRUE]
               /\ pc' = [pc EXCEPT ![w] = "half-committed"]
               /\ UNCHANGED <<log, snap, staged, attempts>>

\* Only reachable when the two writes are separate statements.
FinishCommit(w) ==
  /\ pc[w] = "half-committed"
  /\ log' = Append(log, staged[w])                     \* ... receipt second
  /\ mid' = [mid EXCEPT ![w] = FALSE]
  /\ pc' = [pc EXCEPT ![w] = "done"]
  /\ UNCHANGED <<rows, snap, staged, attempts>>

\* The process dies: local state is gone; whatever was committed stays.
Crash(w) ==
  /\ pc[w] \notin {"done", "failed", "crashed"}
  /\ pc' = [pc EXCEPT ![w] = "crashed"]
  /\ UNCHANGED <<log, rows, snap, staged, attempts, mid>>

Next == \E w \in Workers :
          DupCheck(w) \/ Begin(w) \/ Compute(w) \/ Commit(w) \/ FinishCommit(w) \/ Crash(w)

Spec == Init /\ [][Next]_vars

TypeOK ==
  /\ pc \in [Workers -> {"idle", "check-passed", "begun", "computed", "half-committed",
                         "done", "failed", "crashed"}]
  /\ attempts \in [Workers -> 0..MaxAttempts]

\* spec/semantic-model.md section 4, `ReceiptChainIntegrity`: sequences are
\* 0,1,2,... with no gap or repeat, and each receipt names its predecessor's digest.
ReceiptChainIntegrity ==
  \A i \in 1..Len(log) :
    /\ log[i].seq = i - 1
    /\ log[i].prev = IF i = 1 THEN GENESIS ELSE Digest(log[i - 1])

\* An event is accepted at most once: duplicate submission never yields a second receipt.
NoDuplicateReceipts ==
  \A i, j \in 1..Len(log) : log[i].event = log[j].event => i = j

\* spec section 6.1: an accepted event is never observable without its receipt,
\* and a receipt never exists without its event, even across a crash.
AtomicEventAndReceipt ==
  rows = {log[i].event : i \in 1..Len(log)}

\* Receipts are append-only (no reorder, delete, or rewrite): the log only ever extends.
AppendOnly == [][log' = log \/ (Len(log') = Len(log) + 1 /\ SubSeq(log', 1, Len(log)) = log)]_vars
====
