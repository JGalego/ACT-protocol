# ADR 0007: CLI Local Workspace Trust Model

## Status

Accepted

## Context

`apps/cli` operates against a local, embedded SQLite ledger (`act init`
creates `.act/ledger.db`) without necessarily talking to `services/api`.
It needs a trust model simple enough for a single local user, while still
reusing `@act/ledger`'s real `TrustPolicy` interface rather than a
special-cased bypass.

## Decision

`act init` generates one Ed25519 identity and writes it to
`.act/config.json` (public material) and `.act/identity.key.json`
(private key, plaintext, mode `0600`) — explicitly a local development
convenience, not a production credential store (`docs/security-and-privacy-guide.md`).
`.act/trusted-keys.json` seeds with exactly that one key. `apps/cli/src/ledger-factory.ts`'s
`TrustPolicy.isTrusted` re-reads `trusted-keys.json` on every call (not a
snapshot captured once at ledger construction), so a key trusted mid-operation
— e.g. via a `Key` artifact event's proof-of-possession bootstrap
encountered partway through `act import`, mirroring ADR 0006's API-side
logic — is honored by the very next event in the same batch.

`act key trust <keyId> <publicKey>` lets a user explicitly extend trust to
another workspace's key ahead of importing a bundle from it; the CLI does
not auto-trust arbitrary keys encountered during import unless they arrive
via a self-verifying `Key` artifact event.

## Consequences

- A single-user local workspace has zero-configuration trust for its own
  identity, matching the "embedded operation" requirement's spirit of
  being immediately usable.
- Cross-workspace federation via `act export`/`act import` requires an
  explicit `act key trust` step (or a `Key` artifact event in the bundle)
  before events signed by an unfamiliar key are accepted — an unknown key
  is reported as `invalid_signature` (no public key on file to check the
  signature against) rather than silently trusted, consistent with
  ACT-1.0.md section 6.1's write-path ordering (signature verification
  precedes trust-policy evaluation).
