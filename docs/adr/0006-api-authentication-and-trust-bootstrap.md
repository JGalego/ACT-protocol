# ADR 0006: API Authentication and Trust-Bootstrap Model (Phase 1)

## Status

Accepted

## Context

`PROMPT.md` requires OIDC/OAuth 2.0 JWT validation for production, Ed25519 service identities for signed protocol events, a clearly-marked local development identity provider disabled in production, and — most relevantly here — that "API callers MUST NOT gain protocol authority merely because they are authenticated," keeping authentication, signature verification, trust, and authorization as separate evaluations (ACT-1.0.md section 11).

A new actor needs a key-registration path. Registration must apply an explicit trust policy rather than trust the first submitted key (Core Principle 7).

## Decision

**Authentication (who is calling):** `services/api/src/plugins/auth.ts` implements only a local development bearer scheme — the bearer token is taken directly as the caller's actor id, used for tenant scoping, rate limiting, and audit correlation. It is active only when `ACT_DEV_MODE=true`; `services/api/src/server.ts` refuses to start in `NODE_ENV=production` without it, per PROMPT.md's fail-closed requirement. Production-grade OIDC/JWT validation is deferred (`docs/roadmap.md`) — this scheme authenticates a caller for operational purposes only and grants no ledger authority by itself.

**Trust bootstrap (who the ledger accepts signed events from):** `POST /v1/keys` is the sole bootstrap path. A new key's registration event carries a `Key` artifact record whose own `data.public_key` field is the raw public key. The route independently verifies (via `@act/crypto`'s `verifyEnvelope`, _before_ touching the ledger) that this embedded public key actually produces the event's attached signature — proof of possession of the corresponding private key. Only on success is the key added to `ledger-context.ts`'s in-memory `KeyRegistry` (which implements `@act/ledger`'s `TrustPolicy`) _before_ the event is appended, so the ledger's own independent trust-policy evaluation (`ACT-1.0.md` section 4.5, step 4 of the write path) passes consistently rather than being bypassed. If the subsequent append fails for any other reason, the key registration is rolled back. `POST /v1/actors` requires the signing key to already be registered this way — registering an identity does not itself grant trust; possessing a keypair and proving it does.

This is intentionally a **Phase 1 simplification**: it grants trust to any caller who can produce a valid self-signature, with no organizational vetting, admin approval, or quorum. It is documented, not hidden, in `services/api/openapi/act-v1.yaml`'s security scheme description and here.

## Consequences

- Two independent evaluations exist for every write: "is this signature cryptographically valid" and "is this key on our trust list" — matching ACT-1.0.md section 4.5's requirement that these never collapse into one boolean. The test suite in `services/api/src/__tests__/server.test.ts` exercises both failure modes distinctly (`invalid_signature` vs. `untrusted_actor` vs. `proof_of_possession_failed`).
- Any deployment that needs actual organizational admission control (only known, vetted actors may register) must add an authorization policy in front of `POST /v1/keys` — this release does not gate it, and that gap is listed in `docs/roadmap.md` and `docs/threat-model.md`.
- Federation bundle import (`POST /v1/bundles/import`, `apps/cli`'s `act import`) performs the identical proof-of-possession bootstrap per `Key` artifact event encountered in the bundle, so a batch of events from an unfamiliar source ledger can still be individually verified without requiring an out-of-band key exchange first.

## Amendment: Production OIDC/JWT Validation

On 2026-07-18, `services/api` added production OIDC/JWT bearer-token validation.

`plugins/auth.ts` now supports a second, mutually-exclusive path alongside the dev bearer scheme: when `oidc/jwt-verifier.ts`'s `OidcConfig` (issuer + audience, either passed to `buildServer` or read from `ACT_OIDC_ISSUER`/`ACT_OIDC_AUDIENCE`/`ACT_OIDC_JWKS_URI`) is set, an incoming bearer token is verified with `jose` -- real signature verification against the issuer's JWKS (fetched via OIDC discovery unless `ACT_OIDC_JWKS_URI` is given, then cached), plus issuer, audience, and expiry checks. The token's `sub` claim becomes `callerActorId` and its `act_tenant` claim (configurable, defaulting to `'default'` when absent) becomes `tenantId`. As before, this only establishes _who is calling_ -- it grants no ledger authority; every write still independently requires the submitted event envelope's own Ed25519 signature from a registered key.

`server.ts` refuses production startup when `ACT_DEV_MODE` is enabled or OIDC configuration is absent.

`oidc/dev-provider.ts` is a deterministic, offline local OIDC provider -- a real HTTP server serving OIDC discovery, a JWKS endpoint, and a token-issuance endpoint signed with a freshly generated RS256 keypair -- so the verifier is testable end-to-end (`services/api/src/__tests__/oidc-auth.test.ts`) without a paid external identity provider, mirroring the existing deterministic mock for the OpenAI-compatible semantic assessor (`packages/verification/src/semantic/mock-openai-server.ts`). It is the "local OIDC development provider" `docs/roadmap.md`'s Deployment item still needs wiring into Docker Compose.

This amendment removes "Production OIDC/JWT validation" from deferred scope. Organizational admission control for key registration (`POST /v1/keys` performing no vetting) remains deferred, unchanged.

## Amendment: ADR 0009 (attribution, key identity, durable trust)

The bootstrap described above is tightened by ADR 0009. A `key_id` must now be the fingerprint of its public key and the registering actor must own the key, so a key id cannot be claimed for someone else's key; a rejected registration no longer deletes an existing key; and the registry is rebuilt from the event log, so trust survives restarts and replicas. Registration is administrator-only by default outside dev mode (`ACT_KEY_REGISTRATION`). Federation import no longer bootstraps trust from any self-signed Key event: it requires a registered peer with a pinned ledger identity, and only a Key event inside a bundle verified against that pin may add a key.

## Amendment: ADR 0010 (tenant from authentication)

The tenant is established here and nowhere else: the verified token's `act_tenant` claim (or, in the development scheme, the `x-act-tenant` header). It is format-checked, and `ACT_REQUIRE_TENANT` (default on in production) refuses a token with no tenant claim instead of falling back to `default`. The tenant selects that tenant's ledger; it is also what a signed event's `tenant` field must equal. See ADR 0010.
