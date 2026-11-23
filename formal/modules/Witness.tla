---- MODULE Witness ----
\* Witnessed checkpoints against forked history (ADR 0013;
\* packages/ledger/src/checkpoint.ts `witnessStep`, `verifyCheckpoint`).
\*
\* A malicious ledger can present ANY history to anyone: it picks, per witness, the
\* sequence of events it claims so far. A history is a sequence over {"a","b"}
\* (two possible events per position), so two histories can fork. An honest witness
\* cosigns a presented history only if it extends the last one that witness cosigned
\* (it checks the receipts between them chain). A corrupt witness cosigns anything.
\* A consumer endorses a history once `Threshold` distinct witnesses have cosigned it.
\*
\* The property: two endorsed histories never conflict. It holds when fewer than
\* `2 * Threshold - W` witnesses are corrupt (any two quorums then share an honest
\* witness); the last mutant shows it failing exactly at that bound.
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS Witnesses,
          Corrupt,           \* the witnesses that sign anything
          Threshold,
          MaxLen,
          CheckConsistency   \* an honest witness cosigns only a history extending its last one

VARIABLES last,       \* last[w]: the history w last cosigned
          cosigned    \* set of <<w, h>>
vars == <<last, cosigned>>

Histories == UNION {[1..n -> {"a", "b"}] : n \in 0..MaxLen}

IsPrefix(p, h) == Len(p) <= Len(h) /\ \A i \in 1..Len(p) : p[i] = h[i]

Init ==
  /\ last = [w \in Witnesses |-> <<>>]
  /\ cosigned = {}

Cosign(w, h) ==
  /\ (w \in Corrupt \/ ~CheckConsistency \/ IsPrefix(last[w], h))
  /\ last' = [last EXCEPT ![w] = IF w \in Corrupt THEN @ ELSE h]
  /\ cosigned' = cosigned \cup {<<w, h>>}

Next == \E w \in Witnesses, h \in Histories : Cosign(w, h)

Spec == Init /\ [][Next]_vars

Signers(h) == {w \in Witnesses : <<w, h>> \in cosigned}
Endorsed(h) == Cardinality(Signers(h)) >= Threshold

TypeOK ==
  /\ last \in [Witnesses -> Histories]
  /\ cosigned \subseteq (Witnesses \X Histories)

\* No two endorsed checkpoints describe conflicting histories: one always extends the other.
NoSplitView ==
  \A h1, h2 \in Histories :
    (Endorsed(h1) /\ Endorsed(h2)) => (IsPrefix(h1, h2) \/ IsPrefix(h2, h1))
====
