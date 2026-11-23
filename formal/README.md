# Formal verification

Machine-checked TLA+ models of the protocol's safety-critical rules, checked with the real TLC model checker (`make verify-formal`, `scripts/formal/run-tlc.sh`). It downloads a pinned, checksum-verified `tla2tools.jar` on first run; it needs Java 17+ and no Docker. Every model is tied to the code by a test, and every model is shown to be non-vacuous by mutants that TLC must break.

## What this proves, and what it does not

Each model states what an **adversary** can do and asks TLC to explore _every_ interleaving of those actions within the stated bounds. A model passing means: **no reachable state, up to those bounds, violates the named invariant.** It does not mean the invariant holds for all sizes (TLC is a bounded, explicit-state checker), it says nothing about the cryptography itself (SHA-256 and Ed25519 are modelled as perfect: a hash is injective, only the holder of a private key can sign), and it verifies the model, not the TypeScript. The gap between model and code is closed by testing (see "Tying the models to the code"), not by proof. A bounded check is still strong evidence for this kind of protocol logic: the bugs found in the project review were all short counterexamples (3 to 10 steps).

## The models

| Module | Question it answers | Adversary / environment | Invariants checked |
| --- | --- | --- | --- |
| `WritePath` | Can an event be accepted that is attributed to someone who did not sign it? Can a key id be taken over, a revoked key keep signing, or an artifact be hijacked? | Two corrupt principals who can sign with their own keys, register keys under any label/owner, revoke, and submit any event they can build; honest events can be replayed | `NoForgedAttribution`, `KeyBindingStable`, `NoResurrection`, `OnlyOwnerRevokes`, `NoRevokedKeyAccepted`, `NoArtifactTakeover` |
| `LedgerAppend` | With concurrent appends, retries and crashes, does the receipt log stay a gap-free hash chain with no duplicate or half-written entries? | Three workers (two submitting the same event) racing on `MAX(sequence)+1` from REPEATABLE READ snapshots, with a crash possible at any step | `ReceiptChainIntegrity`, `NoDuplicateReceipts`, `AtomicEventAndReceipt`, `AppendOnly` |
| `ApprovalAuthorization` | Does the authorization algorithm authorize exactly when spec section 8.3 says (never without a valid, current, non-revoked, quorum-satisfying approval; never from another version's approval)? Does the write-time lifecycle hold? | Reviewers decide, revoke, let decisions expire (a clock), cancel; the algorithm is transcribed and compared state by state with an independent spec predicate | `ImplMatchesSpec`, `NoInheritedApproval`, `DecisionHasRequest`, `ReviewerDecidesOnce`, `CancelledStaysUndecided`, `EndedIsTerminal` |
| `IntentAuthority` | Can a version become effective without an authority-satisfying selection? Can write order pick a winner? Can there be two baselines? | Any actor may propose; any set of actors may sign a selection | `EffectiveIntentSafety`, `EffectiveOnlyBySelection`, `EffectiveRequiresAuthority`, `NoUnauthorizedRevival` |
| `Federation` | Can the local ledger end up holding events its pinned peer never accepted? Are missing-parent boundaries accurate? | A network adversary who forwards, tampers with, or forges bundles, including self-consistent ones from his own ledger | `NoForgedEvents`, `NoUndeclaredGaps`, `BoundaryAccurate` |
| `LedgerReceiptChain`, `AcyclicLineage`, `ApprovalLifecycle`, `KeyLifecycle`, `ChallengeLifecycle`, `ArtifactVersionLifecycle` | The single-record state machines of `spec/state-machines.md`, one module each (the earlier models) | none: pure transition tables | `TypeOK`, terminal-state stability, `AcyclicLineage`, `ReceiptChainIntegrity` |

The last row is deliberately weak. Those modules are 4 to 16 states each and no adversary is involved; they check that the spec's state diagrams are internally consistent and that terminal states are terminal. They found none of the bugs in the review. `ApprovalLifecycle` once carried a property (`OnlyApprovedAuthorizes`) that restated its own transition guards and could never fail; it was removed rather than counted. `AcyclicLineage` checks the cycle-rejection discipline of `detectCycle`, which a single ledger can never exercise (event ids hash their parents); see the note in the module.

## Non-vacuity: the mutants

A model that cannot fail proves nothing. Each safeguard in the real code corresponds to a boolean constant in its model (`BindSigner`, `UniqueSeq`, `CheckGaps`, ...). The shipped `formal/modules/*.cfg` turn every safeguard on. For each safeguard, `formal/mutants/<Module>.<name>.cfg` turns it (or the minimal combination that matters) off and declares the violation TLC must find on its `\* EXPECT:` line. `run-tlc.sh` runs all of them every time and **fails if a mutant is not caught, or breaks a different property than expected**. A shipped model passing while its mutant is caught means the invariant is reachable-and-violable, and that this specific guard is what upholds it.

Current result: **11 models verified, 27 mutants caught.**

| Module | Mutants (each removes one rule) |
| --- | --- |
| `WritePath` (10) | `no-bind-signer`, `no-bind-actor`, `no-fingerprint-no-owner`, `no-fingerprint-overwrite`, `overwrite-resurrects`, `no-revoke-auth`, `no-status-check`, `no-cosigner-check`, `no-genesis-owner`, and `original-code` (every guard off: the write path as it was before ADR 0009, broken in 4 steps) |
| `LedgerAppend` (3) | `no-unique-sequence`, `no-unique-event`, `non-atomic-append` |
| `ApprovalAuthorization` (6) | `counts-same-reviewer-twice`, `ignores-revocation`, `ignores-expiry`, `ignores-separation-of-duties`, `ignores-role`, `approval-inherited-by-new-version` |
| `IntentAuthority` (4) | `anyone-may-select`, `proposer-selects-own`, `no-supersede`, `write-order-picks-winner` |
| `Federation` (4) | `no-bundle-signature-check`, `no-bundle-digest-check`, `no-peer-pinning`, `no-gap-declaration-check` |

Two things the mutants taught, worth keeping:

- **Redundant guards.** Several mutants only break once a _second_ defence is also off. A key id that is not the fingerprint of its key is harmless _because_ the owner must register it _and_ overwrites are refused; dropping `NoOverwrite` alone changes nothing observable except resurrecting a revoked key. A rejected decision is excluded both by its verdict and by its state. These are defence in depth, and the model says which layer carries which property. The checked-in mutants are the ones where removing a single guard is observable; the pairs are named for what they combine.
- **A bounded model reflects its bounds.** An early `ApprovalAuthorization` mutant for the role filter survived because separation of duties already excluded the only ineligible reviewer in that configuration. The mutant's own config now removes that shadow. If you add a guard, add a mutant, and check it is not shadowed.

## Tying the models to the code

A TLA+ model proves facts about the TLA+ model. Three mechanisms connect it to the TypeScript:

1. **Differential test against a spec oracle** (`packages/verification/src/__tests__/authorization.test.ts`). `evaluateApprovalAuthorization` is the code counterpart of `ApprovalAuthorization.tla`. It is compared with an independent transcription of spec section 8.3 (an existential over subsets of decisions) over every combination of the configuration space: about 1.2 million one- and two-decision cases plus 20,000 seeded larger ones. Zero disagreements.
2. **Stateful adversarial test of the real API** (`services/api/src/__tests__/model-based.test.ts`). It plays the models' adversary (two corrupt principals, two honest ones) against the real Fastify handlers over seeded random action sequences (key registration, key takeover, intents with forged actor/key/signers, artifact-body-free events, genesis takeover, key revocation, approval requests and decisions). For each action it compares the API's accept/reject with a reference predicate transcribed from the TLA+ guards (`predictAccept*`), and after every step it re-checks the model's invariants against the ledger's own contents: no event whose actor key did not sign it, no event under a revoked key, a verified gap-free hash-chained receipt log, one decision per reviewer per request, no artifact with genesis events by two actors.
3. **The same mutants, run against the code.** The stateful test is itself checked for non-vacuity by re-introducing the original bugs into the real source one at a time (drop the signer check, drop owner binding, allow a second genesis, skip the approval lifecycle, ignore key status). All five are caught. (A first version missed the signer check, because an artifact's own authoring signature independently rejects those attacks; the artifact-body-free action was added for exactly that reason.)

What is _not_ connected by test: `Federation` and `LedgerAppend` are exercised by `services/api/src/__tests__/hardening.test.ts`, `packages/ledger`'s shared adapter suite (run against both SQLite and a real PostgreSQL, including genuine concurrent appends), and `scripts/integration-smoke.ts`, but there is no randomized refinement test for them yet.

## Running

```bash
make verify-formal              # every model and every mutant (about 3 minutes)
bash scripts/formal/run-tlc.sh WritePath          # only models/mutants whose name contains this
```

`ApprovalAuthorization` dominates the runtime (about 3 million distinct states, a couple of minutes). `-workers auto` uses every core.

## Why one module per concern, not one composed spec

The models share vocabulary but not state. A single composed specification over keys, the log, approvals, intents and federation would multiply the state space (the approval model alone reaches millions of states) while adding no invariant that spans more than one of them: attribution does not depend on quorum, and quorum does not depend on the chain. Where two concerns do interact (the write path trusts the key registry; approvals trust attribution), the dependency is stated as an assumption in the dependent model's header and discharged by the other model's invariant.

## What a stronger proof would take

Roughly in order of value:

1. **Unbounded proofs of the core invariants.** `NoForgedAttribution` and `ReceiptChainIntegrity` have small inductive invariants. Proving them for all numbers of principals and events needs TLAPS (or Apalache with an inductive-invariant check) and is a bounded amount of work.
2. **Refine the models into the code.** Generate TLC traces and replay them against the API, or validate recorded implementation traces against the spec (trace validation). The randomized test above is the cheap version of this.
3. **Prove the pure functions** (`evaluateApprovalAuthorization`, `evaluateQuorum`, `evaluateKeyValidityAt`, `verifyReceipt`) in Dafny or Lean, which could also give one verified source for both SDKs.
4. **A protocol-level cryptographic analysis** (Tamarin or ProVerif) of signature binding and federation: replay across payload types, key substitution, and bundle splicing.
