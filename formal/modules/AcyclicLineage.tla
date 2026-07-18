---- MODULE AcyclicLineage ----
\* Models the AcyclicLineage invariant (spec/semantic-model.md section 4,
\* spec/ACT-1.0.md section 6.3), directly mirroring
\* packages/ledger/src/cycle.ts's detectCycle: only lineage-typed relations
\* (input, output, revision-of, merge-of) participate; a new edge is
\* rejected if the child is already a (transitive) ancestor of the parent.
EXTENDS Naturals, FiniteSets
CONSTANT Nodes
VARIABLE reach
vars == <<reach>>

Init == reach = {}

\* Adding edge parent->child is rejected if child already reaches parent
\* (that would close a cycle) -- this guard is cycle.ts's detectCycle.
\* On acceptance, reach is updated transitively: every existing ancestor of
\* parent (plus parent itself) now reaches every existing descendant of
\* child (plus child itself).
AddEdge(parent, child) ==
  /\ parent # child
  /\ <<child, parent>> \notin reach
  /\ LET Predecessors == {parent} \cup {x \in Nodes : <<x, parent>> \in reach}
         Successors   == {child}  \cup {y \in Nodes : <<child, y>> \in reach}
     IN reach' = reach \cup (Predecessors \X Successors)

Next == \E parent, child \in Nodes : AddEdge(parent, child)
Spec == Init /\ [][Next]_vars

TypeOK == reach \subseteq (Nodes \X Nodes)

\* No node can reach itself -- the lineage graph stays acyclic.
AcyclicLineage == \A n \in Nodes : <<n, n>> \notin reach
====
