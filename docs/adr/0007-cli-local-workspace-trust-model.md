# ADR 0007: CLI Local Workspace Trust Model

## Status

Accepted

## Context

The CLI operates on a local SQLite ledger (`.act/ledger.db`) without requiring the API. It uses the ledger's `TrustPolicy` interface for local key trust.

## Decision

`act init` generates one Ed25519 identity and writes it to `.act/config.json` (public material) and `.act/identity.key.json` (private key, plaintext, mode `0600`) — explicitly a local development convenience, not a production credential store (`docs/security-and-privacy-guide.md`). `.act/trusted-keys.json` seeds with exactly that one key. `apps/cli/src/ledger-factory.ts`'s `TrustPolicy.isTrusted` re-reads `trusted-keys.json` on every call (not a snapshot captured once at ledger construction), so a key trusted mid-operation — e.g. via a `Key` artifact event's proof-of-possession bootstrap encountered partway through `act import`, mirroring ADR 0006's API-side logic — is honored by the very next event in the same batch.

`act key trust <keyId> <publicKey>` lets a user explicitly extend trust to another workspace's key ahead of importing a bundle from it; the CLI does not auto-trust arbitrary keys encountered during import unless they arrive via a self-verifying `Key` artifact event.

## Consequences

- A new local workspace trusts its generated identity.
- Cross-workspace federation via `act export`/`act import` requires an explicit `act key trust` step (or a `Key` artifact event in the bundle) before events signed by an unfamiliar key are accepted — an unknown key is reported as `invalid_signature` (no public key on file to check the signature against) rather than silently trusted, consistent with ACT-1.0.md section 6.1's write-path ordering (signature verification precedes trust-policy evaluation).

## Amendment: ADR 0009 (key ownership, verified bundles)

`act key trust` now requires the key id to be the fingerprint of the public key, never replaces an already-trusted key or owner, and takes `--owner <actorId>`. A key trusted without an owner can verify bundles but cannot author events: `.act/key-owners.json` records key ownership, and the trust policy only accepts an event whose key belongs to the actor it names. `act import` refuses a bundle unless it is signed by an already-trusted key and its id matches its body, verifies each source receipt against that key, tolerates a missing parent only where the bundle declares the gap, and quarantines anything that fails. `act export` computes `completeness` and `known_gaps` instead of asserting `complete`. A self-signed Key event inside a verified bundle may add a key with its owner, but can no longer overwrite one.
