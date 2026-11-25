# ADR 0013: Witnessed Checkpoints Against Hidden and Forked History

## Status

Accepted. Extends ADR 0009 (federation trust) and spec section 5.3 (the receipt chain).

## Context

The receipt chain makes a ledger's history tamper-evident _to anyone who already holds a receipt_: rewriting an earlier event breaks every later digest. It does not stop the operator from:

- **showing different histories to different parties** (a fork or split view): each party sees a valid chain, and no party has anything that contradicts it;
- **withholding the tail**: answering "this is everything" while recent events are hidden;
- **truncating and re-extending** history for a party who only checks the head they were shown.

These attacks require independent observations of the ledger's history. Certificate-transparency-style witnesses refuse to endorse histories that conflict with what they previously observed; consumers require a quorum of their configured witnesses.

## Decision

**A checkpoint commits to the whole history so far.** A checkpoint is `{ledger_id, size, head_digest, issued_at}`: `size` is the number of receipts, `head_digest` is the digest of the last receipt (the genesis constant when empty). Because receipts are hash-chained, `head_digest` fixes every event and its order. The ledger signs it (`ACT-CHECKPOINT-v1`, its receipt-signing key) to make a **signed checkpoint**.

**Witnesses cosign only what extends what they last saw.** A witness is an independent party with its own Ed25519 key. It keeps the last checkpoint it cosigned for each ledger. Given a newer checkpoint it fetches the receipts between the two sizes and verifies that they chain from the old head to the new head, are each signed by the ledger, and have consecutive sequence numbers; only then does it cosign (`ACT-WITNESS-v1`, a different domain from the ledger's signature so neither can be replayed as the other). A checkpoint the witness cannot reconcile with its last one (same size and different head, or no chain between them) is refused, and the pair is itself **proof of equivocation** by the operator, because both are signed by the ledger's key.

**Acceptance requires a quorum.** A consumer (an auditor, a federation peer, a client) trusts a checkpoint only when it carries valid cosignatures from at least `k` of its configured witnesses. Two checkpoints with conflicting histories cannot both reach `k` unless at least `2k - W` witnesses sign both, so with `W` witnesses of which fewer than `2k - W` are corrupt, a split view cannot be quorum-endorsed. The configuration, not the protocol, decides `W` and `k`; the model checks the bound.

**Proofs.** Consistency between two checkpoints and inclusion of an event in a checkpoint are both shown by the receipts that link them (`GET /v1/receipts`), verified by `verifyConsistency` and `verifyInclusion`. Because the chain is linear these proofs are _linear_ in the distance, not logarithmic; a Merkle-tree log would shorten them but is a change of receipt format and is not made here.

**API (per tenant, ADR 0010).** `GET /v1/checkpoint` returns the signed checkpoint for the current head with every cosignature collected for it. `GET /v1/receipts?after=&limit=` returns receipts for proofs. An administrator registers trusted witnesses with `POST /v1/witnesses`; a witness submits a cosignature with `POST /v1/checkpoints/{size}/witness`, which the ledger accepts only from a registered witness with a valid signature over that exact checkpoint. The ledger stores cosignatures but never decides who is trustworthy: consumers verify against their own witness set. `@act/ledger` exports the checkpoint primitives and `runWitness`, the witness step, so a witness is a small process rather than a new service.

## Verification

`formal/modules/Witness.tla` lets a malicious ledger present any history to witnesses that cosign only prefix-extending ones, with some witnesses corrupt, and checks that no two quorum-endorsed checkpoints conflict. Mutants drop the consistency check, lower the threshold below the intersection bound, and let corrupt witnesses reach it. Unit tests cover signing, domain separation, quorum counting, consistency and inclusion proofs, and a forked operator; an API test runs a real witness against a real ledger and against a fork.

## Consequences

- An operator can no longer show two parties different histories without the pair being detectable and, if a quorum is required, unendorsable. Withholding the tail is detected by a consumer that insists on a recent quorum-cosigned checkpoint.
- Detection depends on witnesses actually running and on consumers actually requiring quorum cosignatures. A ledger with no registered witnesses has no more protection than before; the API says so by returning an empty cosignature list.
- Collusion between the operator and at least `2k - W` witnesses defeats it, as in any witness scheme.
- Proofs are linear in the number of receipts between checkpoints. Frequent checkpoints keep them short.
- Checkpoints are per tenant: each tenant's ledger has its own chain and so its own checkpoints and witness set.
