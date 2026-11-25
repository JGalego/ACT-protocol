# Formal verification

TLA+ models of the protocol's safety rules. `make verify-formal` runs TLC against the models and deliberately broken configurations. It requires Java 17+, downloads a pinned, checksum-verified `tla2tools.jar` on first run, and does not require Docker.

## Scope and Limits

TLC explores the adversary's actions within each model's bounds. A passing check means **no reachable state within those bounds violates the named invariant**. It does not establish the invariant for all sizes or verify the TypeScript implementation. SHA-256 and Ed25519 are modeled as perfect: hashes are injective and only a private-key holder can sign. Tests compare model-derived predicates with the code, but do not prove their correspondence. The review bugs had short model counterexamples of 3 to 10 steps.

## The models

| Module | Question it answers | Adversary / environment | Invariants checked |
| --- | --- | --- | --- |
| `WritePath` | Can an event be accepted that is attributed to someone who did not sign it? Can a key id be taken over, a revoked key keep signing, or an artifact be hijacked? | Two corrupt principals who can sign with their own keys, register keys under any label/owner, revoke, and submit any event they can build; honest events can be replayed | `NoForgedAttribution`, `KeyBindingStable`, `NoResurrection`, `OnlyOwnerRevokes`, `NoRevokedKeyAccepted`, `NoArtifactTakeover` |
| `LedgerAppend` | With concurrent appends, retries and crashes, does the receipt log stay a gap-free hash chain with no duplicate or half-written entries? | Three workers (two submitting the same event) racing on `MAX(sequence)+1` from REPEATABLE READ snapshots, with a crash possible at any step | `ReceiptChainIntegrity`, `NoDuplicateReceipts`, `AtomicEventAndReceipt`, `AppendOnly` |
| `ApprovalAuthorization` | Does the authorization algorithm authorize exactly when spec section 8.3 says (never without a valid, current, non-revoked, quorum-satisfying approval; never from another version's approval)? Does the write-time lifecycle hold? | Reviewers decide, revoke, let decisions expire (a clock), cancel; the algorithm is transcribed and compared state by state with an independent spec predicate | `ImplMatchesSpec`, `NoInheritedApproval`, `DecisionHasRequest`, `ReviewerDecidesOnce`, `CancelledStaysUndecided`, `EndedIsTerminal` |
| `IntentAuthority` | Can a version become effective without an authority-satisfying selection? Can write order pick a winner? Can there be two baselines? | Any actor may propose; any set of actors may sign a selection | `EffectiveIntentSafety`, `EffectiveOnlyBySelection`, `EffectiveRequiresAuthority`, `NoUnauthorizedRevival` |
| `Federation` | Can the local ledger end up holding events its pinned peer never accepted? Are missing-parent boundaries accurate? | A network adversary who forwards, tampers with, or forges bundles, including self-consistent ones from his own ledger | `NoForgedEvents`, `NoUndeclaredGaps`, `BoundaryAccurate` |
| `TenantIsolation` | Can a tenant observe, use, or detect anything another tenant did: through a duplicate, a read, a parent lookup, a receipt sequence number, a key conflict, a peer list, an administrator entry or an import? | Every tenant is an adversary: it registers keys, submits events naming any tenant, key and parent, reads, lists peers, pins other tenants and imports bundles against one shared store. Each action compares the implementation's answer with the answer the tenant would get alone | `ResponsesIndependent`, `NoCrossTenantTrust`, `EventsNameTheirTenant`, `AdminsAreTenantScoped`, `ImportsOnlyFromPinnedPeers` |
| `RoleAssignment` | Can a role be held without a legitimate grant? Can an owner grant outside their scope or to themselves, a stranger end someone's role, a revoked, ended or lapsed role still decide, or an ended assignment come back? | Corrupt principals who grant, end, revive and decide at any time while assignments expire; one principal administers the tenant | `GrantsAuthorized`, `ChangesAuthorized`, `TerminalIsFinal`, `DecisionsAuthorized`, `TracesToAdministrator` |
| `ImportTrustTime` | Is an imported event judged by whether its key was valid when the source ledger accepted it? Can a retired key still smuggle in events the source accepted after retirement, can a signer choose the time, and is legitimate history ever refused? | A key that is revoked or compromised at any local moment; events with every combination of source acceptance time and signer-claimed time, offered at every later moment | `NoInvalidImport`, `NoValidRefused` |
| `Witness` | Can an operator show two parties conflicting histories and have both endorsed? | A malicious ledger that presents any history to any witness; honest witnesses cosign only a history extending their last one, corrupt witnesses cosign anything; a consumer needs `Threshold` cosignatures | `NoSplitView` (holds while fewer than `2*Threshold - W` witnesses are corrupt) |
| `LedgerReceiptChain`, `AcyclicLineage`, `ApprovalLifecycle`, `KeyLifecycle`, `ChallengeLifecycle`, `ArtifactVersionLifecycle` | The single-record state machines of `spec/state-machines.md`, one module each (the earlier models) | none: pure transition tables | `TypeOK`, terminal-state stability, `AcyclicLineage`, `ReceiptChainIntegrity` |

The single-record modules have 4 to 16 states and no adversary. They check state-diagram consistency and terminal states, and found none of the review bugs. `ApprovalLifecycle`'s former `OnlyApprovedAuthorizes` property merely restated its guards and could not fail, so it was removed. `AcyclicLineage` checks cycle-rejection discipline; a single ledger cannot exercise that case because event ids hash their parents. See the module's note.

## Non-vacuity: the mutants

Safeguards correspond to model constants such as `BindSigner`, `UniqueSeq`, and `CheckGaps`. The shipped configurations enable them; each mutant disables a guard or guard combination and names the expected violation on its `\* EXPECT:` line. `run-tlc.sh` **fails if TLC misses a mutant or reports a different violation**. These checks establish that the modeled invariant can fail when its safeguards are removed.

Current result: **Models verified; expected mutant violations detected.**

| Module | Mutants (each removes one rule) |
| --- | --- |
| `WritePath` | `no-bind-signer`, `no-bind-actor`, `no-fingerprint-no-owner`, `no-fingerprint-overwrite`, `overwrite-resurrects`, `no-revoke-auth`, `no-status-check`, `no-cosigner-check`, `no-genesis-owner`, and `original-code` (every guard off: the write path as it was before ADR 0009, broken in 4 steps) |
| `LedgerAppend` | `no-unique-sequence`, `no-unique-event`, `non-atomic-append` |
| `ApprovalAuthorization` | `counts-same-reviewer-twice`, `ignores-revocation`, `ignores-expiry`, `ignores-separation-of-duties`, `ignores-role`, `approval-inherited-by-new-version` |
| `IntentAuthority` | `anyone-may-select`, `proposer-selects-own`, `no-supersede`, `write-order-picks-winner` |
| `Federation` | `no-bundle-signature-check`, `no-bundle-digest-check`, `no-peer-pinning`, `no-gap-declaration-check` |
| `TenantIsolation` | `no-scoped-duplicates`, `no-scoped-reads`, `no-scoped-parents`, `shared-key-registry`, `no-claim-check`, `shared-sequence`, `shared-peer-namespace`, `admin-not-tenant-scoped`, `no-pin-check` |
| `RoleAssignment` | `no-issuer-check`, `owner-any-scope`, `owner-self-grant`, `ignores-revocation`, `ignores-expiry`, `revive-allowed`, `anyone-may-change` |
| `ImportTrustTime` | `judged-at-import-time`, `judged-at-claimed-time`, `ignores-revocation`, `no-compromise-grace` |
| `Witness` | `no-consistency-check`, `threshold-too-low`, `corrupt-at-the-bound` (the guarantee's own limit: one corrupt witness of three with a threshold of two) |

### Guard interactions

- **Redundant guards.** Several mutants only break once a _second_ defence is also off. A key id that is not the fingerprint of its key is harmless _because_ the owner must register it _and_ overwrites are refused; dropping `NoOverwrite` alone changes nothing observable except resurrecting a revoked key. A rejected decision is excluded both by its verdict and by its state. These are defence in depth, and the model says which layer carries which property. The checked-in mutants are the ones where removing a single guard is observable; the pairs are named for what they combine.
- **A bounded model reflects its bounds.** An early `ApprovalAuthorization` mutant for the role filter survived because separation of duties already excluded the only ineligible reviewer in that configuration. The mutant's own config now removes that shadow. If you add a guard, add a mutant, and check it is not shadowed.

## Tying the models to the code

1. **Differential test against a spec oracle** (`packages/verification/src/__tests__/authorization.test.ts`). `evaluateApprovalAuthorization` is the code counterpart of `ApprovalAuthorization.tla`. It is compared with an independent transcription of spec section 8.3 (an existential over subsets of decisions) over every combination of the configuration space: about 1.2 million one- and two-decision cases plus 20,000 seeded larger ones. Zero disagreements.
2. **Stateful adversarial API tests** (`services/api/src/__tests__/model-based.test.ts`, `tenant-model.test.ts`). Seeded action sequences from two corrupt and two honest principals exercise key registration and takeover, forged actor/key/signers, artifact-body-free events, genesis takeover, key revocation, and approvals. Tenant tests exercise cross-tenant operations. Responses are compared with reference predicates transcribed from the TLA+ guards. After each step, tests check signer attribution, key status, receipt-chain integrity, reviewer uniqueness, genesis ownership, and tenant isolation.
3. **Mutation checks against the code.** Reintroducing signer, owner-binding, genesis, approval-lifecycle, and key-status bugs makes the stateful test fail. Its first version missed the signer mutant because artifact authoring signatures independently rejected the attack; artifact-body-free actions were added to expose it. Mutation checks also cover tenant isolation, role assignments (`assignments.test.ts`), import-time trust (`trust-time.test.ts`), and witnessed checkpoints (`checkpoint.test.ts`, `checkpoints.test.ts`).

`federation-model.test.ts` submits valid, partial, mis-declared, tampered, forged, and impersonating bundles to `importBundle`, checking `NoForgedEvents`, `NoUndeclaredGaps`, and `BoundaryAccurate` after each step. Its reintroduced bugs each fail a test. `append-model-suite.ts` checks `ReceiptChainIntegrity`, `NoDuplicateReceipts`, and `AtomicEventAndReceipt` on SQLite and PostgreSQL with concurrent workers, duplicate submissions, and transaction crashes. It found a SQLite bug absent from the model: a read sharing the transaction's connection could observe rows later rolled back.

Model/code correspondence still relies on handwritten reference predicates rather than generated implementation traces, including the tenant, role, trust-time, and witness tests.

## Running

```bash
make verify-formal              # every model and every mutant (about 3 minutes)
bash scripts/formal/run-tlc.sh WritePath          # only models/mutants whose name contains this
```

`ApprovalAuthorization` dominates the runtime (about 3 million distinct states, a couple of minutes). `-workers auto` uses every core.

## Separate Model State Spaces

The models share vocabulary but not state. A single composed specification over keys, the log, approvals, intents and federation would multiply the state space (the approval model alone reaches millions of states) while adding no invariant that spans more than one of them: attribution does not depend on quorum, and quorum does not depend on the chain. Where two concerns do interact (the write path trusts the key registry; approvals trust attribution), the dependency is stated as an assumption in the dependent model's header and discharged by the other model's invariant.

## What a stronger proof would take

1. **Unbounded proofs of the core invariants.** Proving `NoForgedAttribution` and `ReceiptChainIntegrity` for all numbers of principals and events needs TLAPS or an inductive-invariant check with Apalache. TLAPS is not integrated: its installer needs provenance and checksum review before execution (see `docs/formal-methods.md`).
2. **Refine the models into the code mechanically.** Generate TLC traces and replay them against the API, or validate recorded implementation traces against the spec (trace validation). The randomized tests above are the cheap version of this: they compare the code with hand-transcribed guards, so a transcription error in a test is still possible.
3. **Prove the pure functions** (`evaluateApprovalAuthorization`, `evaluateQuorum`, `evaluateKeyValidityAt`, `verifyReceipt`) in Dafny or Lean, which could also give one verified source for both SDKs.
4. **A protocol-level cryptographic analysis** (Tamarin or ProVerif) of signature binding and federation: replay across payload types, key substitution, and bundle splicing.
