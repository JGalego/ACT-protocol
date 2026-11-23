# ADR 0009: Attribution, an Event-Sourced Key Registry, and Federation Trust Pinning

## Status

Accepted. Amends ADR 0006 (trust bootstrap) and ADR 0007 (CLI trust model).

## Context

A review of the release candidate found that the write path verified that signatures were _valid_ and that the _claimed_ actor key was _trusted_, but never that the two were the same key, and that several trust decisions lived in process memory or were simply not made:

- Any trusted key could sign an event that named another actor as its author.
- `POST /v1/keys` accepted any `key_id` (not tied to the public key) and overwrote an existing entry, so a key id could be taken over; a rejected request still deleted the victim's key on rollback.
- Federation import verified nothing about the bundle (signature, id, source ledger, source receipts) and let any self-signed Key event in it become trusted.
- The ledger id, receipt-signing key, key registry and peer list were regenerated or held in memory on every start, so a restart (or a second replica) silently forked the ledger's identity and lost all trust state.
- Approval, key and intent lifecycles in `spec/state-machines.md` were not enforced; privileged transitions such as `intent_effective_selected` were open to anyone.

## Decision

**Attribution.** An event is accepted only if (a) it carries at least one signature, (b) `actor.key_id` is one of the keys that signed it, (c) that key is trusted _and bound to `actor.actor_id`_ (`TrustPolicy.isTrusted(actorId, keyId)` is now a binding check, not a key-known check), and (d) every co-signing key is itself trusted. Artifact payloads additionally have their `version_id` recomputed, their subject checked against the event, and their authoring signature verified (spec section 3: recompute at trust boundaries).

**Key identity.** A `key_id` must be the fingerprint of its public key (`ed25519:<sha-256 of the raw key>`), so one actor cannot claim another's key id. A key registers itself by signing its own registration, and only its owner may do so. Who may bootstrap at all is an operator setting (`ACT_KEY_REGISTRATION`: `open` in dev mode, `admin` otherwise).

**The key registry is a projection.** It is never written directly; it is computed from the accepted event log and caught up before each write (`services/api/src/key-registry.ts`). A restart or another replica sharing the database therefore yields the identical registry (spec section 6.2). One pure function, `evaluateKeyEvent`, both vets a request and replays history, so the live registry and a replay cannot disagree. Key rotation, revocation and compromise are events (`key_rotated`, `key_revoked`, `key_compromised`) signed by a trusted key of the same owner; a revoked or compromised key is refused for later writes. Key validity at a past time uses `evaluateKeyValidityAt`, which now fails closed on unparseable timestamps and on signatures that predate the key.

**Durable ledger identity.** The ledger id and receipt-signing key are created once and stored in the ledger's own database (a small `ledger_meta` table), shared by all replicas of that database. `ACT_LEDGER_PRIVATE_KEY` keeps the private key out of the database; startup refuses a key that does not match the registered one.

**Federation trust is pinned, not learned.** An operator registers a peer with its `ledgerId`, `ledgerKeyId` and `ledgerPublicKey` (obtained out of band from the peer's `GET /v1/ledger`). A bundle is accepted only if it names a registered peer, its `bundle_id` is the digest of its body, it is signed by the pinned key, and each source receipt verifies against that key. A missing causal parent is tolerated only where the bundle declares the gap in `known_gaps`; export computes `completeness` and `known_gaps` instead of asserting `complete`. A self-signed Key event inside such a verified bundle may introduce a key, because the operator already trusts that peer for its own actors. Peers, imports and the quarantine list are administrator operations (`ACT_ADMIN_ACTORS`); peer URLs are checked against loopback/private targets, redirects are refused, and bearer tokens are never returned.

**Enforced lifecycles.** The approval lifecycle is checked at write time (a decision needs an existing request for the same subject, names its signer as reviewer, once per reviewer; only an approved decision can be revoked or expire). Selecting or merging an effective intent requires an authority policy that the signers satisfy; with none configured, no one may. Artifact current state is computed from lineage: competing revisions stay visible as branch tips instead of being collapsed by write order (spec section 7.3).

**Idempotency.** A duplicate `event_id` returns the existing receipt. An `Idempotency-Key` may only name one logical event: a re-signed retry (differing only in `occurred_at`) replays, anything else is `409 idempotency_conflict`.

## Consequences

- Trust state is auditable from the log and survives restarts and replicas. The price is that a key registry must be caught up before use; this is incremental and cheap.
- Federation now requires an explicit, out-of-band pinning step per peer. This is deliberate (spec section 6.4 forbids silently trusting remote ledgers); it makes the ADR 0006 "import bootstraps trust" shortcut conditional on that pin.
- An event signed by a key later revoked used to be refused at import because trust was evaluated at import time. ADR 0012 judges it at the source ledger's acceptance time instead, which is trustworthy because it comes from the verified source receipt.
- Role assignments for authority evaluation were operator-asserted here; ADR 0011 derives them from signed accountability assignments instead.
- Tenant isolation was a documented gap here; ADR 0010 closes it. The key registry, ledger identity and peers described above are now per tenant.
- The operator remained a trust anchor (it could show different parties different histories). ADR 0013 adds witnessed checkpoints to detect that.
