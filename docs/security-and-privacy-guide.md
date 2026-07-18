# Security and Privacy Guide

## Cryptographic Baseline

- **Algorithm**: Ed25519 (RFC 8032) signatures, SHA-256 digests. The registry at `schemas/registry/algorithms.json` is authoritative; adding an algorithm is additive and requires conformance vectors before use (`spec/ACT-1.0.md` section 4.4). No implementation may silently reinterpret an unrecognized algorithm identifier as a known one.
- **Canonicalization**: RFC 8785 (JCS), implemented directly in `packages/core/src/canonical.ts` (ADR 0002) rather than via a third-party dependency, specifically so this security-critical code path stays small enough to audit.
- **Six independent verification results** (`spec/ACT-1.0.md` section 4.5): cryptographic signature validity, event/content digest validity, key status at signing/receipt time, identity binding validity, trust-policy acceptance, and authorization-policy acceptance are never collapsed into one `valid` boolean anywhere in this codebase — `packages/crypto`'s `verifyEnvelope`, `packages/ledger`'s `verifyReceipt`, and `packages/verification`'s finding types all return these as separate fields.

## Key Lifecycle

`packages/crypto/src/key-lifecycle.ts` models `issued`, `active`, `rotated`, `expired`, `revoked`, and `compromised` states. A signature's validity is evaluated against the key's status **at signing time**, not its current status — except that `compromised` retroactively invalidates signatures within a configurable grace period (default 24 hours) before the compromise was recorded, since a compromise discovered later casts retroactive doubt that a mere rotation or expiry does not.

## Secrets Handling

- `apps/cli`'s local workspace stores a plaintext private key under `.act/identity.key.json` (mode `0600`). This is explicitly a local development convenience (ADR 0007), never described as production-appropriate storage. A production deployment MUST use an external key-management service or HSM-backed signing; this repository does not yet ship that integration (see `docs/roadmap.md`).
- `services/api`'s local development bearer scheme (ADR 0006) is disabled by default and forbidden outright in `NODE_ENV=production`; the server refuses to start in production unless real OIDC/JWT validation is configured (`ACT_OIDC_ISSUER` + `ACT_OIDC_AUDIENCE`), failing closed rather than silently accepting unauthenticated callers. `services/api/src/oidc/jwt-verifier.ts` verifies token signature, issuer, audience, and expiry against the issuer's JWKS before trusting any claim.
- No test fixture, example, or committed configuration in this repository contains a real secret. Fixture signatures use placeholder base64 strings (e.g. `ZmFrZQ==`) explicitly for schema-shape testing, never for cryptographic verification of anything meaningful.

## Privacy and Redaction

`schemas/common/content-descriptor.schema.json` separates artifact content from immutable event metadata: every content reference carries a `sensitivity` label (`public`/`internal`/`confidential`/`restricted`), an `availability_state` (`available`/`redacted`/`erased`/`unavailable`), and optional AES-256-GCM `encryption` metadata. Redaction and cryptographic erasure are represented as new signed events that change `availability_state` without rewriting or deleting the original signed history (`spec/ACT-1.0.md` section 15) — the digest, deletion authorization, reason, and time remain inspectable even after content is gone. Full storage-provider and key-provider implementations for encrypted content at rest are tracked in `docs/roadmap.md`; the schema and event-shape support for them exists today.

## Trust Is Not Authentication

Per Core Principle 1 (`spec/ACT-1.0.md`), a valid signature proves control of a key, nothing more. This repository never conflates "signature verifies" with "actor is authorized" — `packages/policy`'s approval-requirement evaluation and `packages/verification`'s approval-validity checks are the only code paths that grant authorization, and both require an explicit, current, non-expired, non-revoked Approval Decision or Authority Policy match.

## Reporting

See `SECURITY.md` for the vulnerability disclosure process. See `docs/threat-model.md` for the structured threat model this guide's mitigations map to.
