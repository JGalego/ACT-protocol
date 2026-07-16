# Threat Model

## Assets

- Ledger event log and receipt chain (integrity, availability)
- Actor private keys (confidentiality)
- Artifact content, especially `confidential`/`restricted`-labeled
  content (confidentiality, availability)
- Policy documents and approval decisions (integrity — a forged approval
  is a direct authorization bypass)
- The API service's availability (denial of service)

## Actors and Trust Boundaries

- **Human and AI-system actors**, each holding one or more Ed25519 keys,
  interacting via `apps/cli`, `packages/sdk-typescript`, or direct HTTP
  calls to `services/api`.
- **The ledger operator** running `services/api` and its SQLite store —
  trusted to run the write path honestly but not implicitly trusted with
  protocol authority beyond what its own trust/authorization policy
  grants (Core Principle 7).
- **Peer ledgers** exchanging federation bundles — explicitly _not_
  trusted by default; `spec/federation.md` requires an explicit trust
  policy per source.
- Trust boundary: the HTTP request boundary at `services/api` (untrusted
  input in, validated/verified/authorized state out); the process
  boundary between a client holding a private key and the server that
  never sees it (all signing happens client-side).

## Attacker Capabilities Considered

An attacker may: submit arbitrary HTTP requests to `services/api`; hold a
validly-generated keypair of their own; observe network traffic (assume
TLS is terminated correctly outside this application's scope); attempt to
replay, reorder, or partially replay previously-observed requests;
possess a compromised actor key; control a federation peer.

## Abuse Cases, Mitigations, and Test Coverage

| Abuse case                                                            | Mitigation                                                                                                                                                                          | Where implemented                                                               | Tested                                                                                                     |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Prompt injection via untrusted text reaching the AI semantic assessor | Compared texts wrapped in explicit `<<<DATA_A>>>`/`<<<DATA_B>>>` delimiters; system prompt instructs the model never to treat their contents as instructions                        | `packages/verification/src/semantic/openai-compatible-assessor.ts`              | `openai-compatible-assessor.test.ts` ("never sends the compared texts as anything but delimited data")     |
| Approval spoofing (forged or replayed approval)                       | Approval Decisions are signed, bound to an exact subject digest and policy version; validity requires current key status, non-expiry, non-revocation                                | `packages/verification/src/approval.ts`                                         | `approval.test.ts` (subject mismatch, expired, revoked-key cases)                                          |
| Confidence inflation (claiming a higher score than evidence supports) | Confidence assessments are attributed and never auto-aggregated; `spec/ACT-1.0.md` section 9 requires evidence for any increase                                                     | `schemas/common/confidence-assessment.schema.json`                              | Schema fixtures; full drift/collapse detection tracked in `docs/roadmap.md`                                |
| Lineage/receipt-chain tampering                                       | Hash-chained receipts; any mutation breaks the chain link, digest, or signature independently                                                                                       | `packages/ledger/src/receipts.ts`, `packages/verification/src/integrity.ts`     | `receipts.test.ts`, `integrity.test.ts` (digest/signature/chain-link failures each independently asserted) |
| Hidden assumptions / hallucinated requirements                        | Uncertainty records with explicit `category` including `assumption`; propagation is required unless explicitly discharged with evidence                                             | `schemas/common/uncertainty.schema.json`, `spec/ACT-1.0.md` section 10          | Schema fixtures; propagation-engine tests tracked in `docs/roadmap.md`                                     |
| Missing or fabricated provenance                                      | Every non-genesis event requires ≥1 causal parent; missing parents are explicitly marked, never silently treated as complete                                                        | `packages/ledger/src/ledger.ts` (`MissingParentError`, partial-import boundary) | `ledger.test.ts` ("rejects... missing causal parent", "records a lineage boundary")                        |
| Key theft, misuse, rotation failure, revocation bypass                | Key status evaluated at signing time; `compromised` retroactively invalidates recent signatures within a grace window                                                               | `packages/crypto/src/key-lifecycle.ts`                                          | `key-lifecycle.test.ts` (7 cases covering issued/active/expired/revoked/compromised, all directions)       |
| Replay / duplicate submission                                         | Event ids are content digests; duplicate submission is idempotent (returns the existing receipt, never a second one)                                                                | `packages/ledger/src/ledger.ts`                                                 | `ledger.test.ts` ("is idempotent for duplicate event submission")                                          |
| Fork and equivocation                                                 | Cycle detection over lineage-typed causal-parent edges, checked before acceptance                                                                                                   | `packages/ledger/src/cycle.ts`                                                  | `cycle.test.ts`, `ledger.test.ts` ("rejects an event that would introduce a lineage cycle")                |
| Actor impersonation                                                   | Signature verification is independent of and prerequisite to trust-policy evaluation; an unregistered key's signature cannot even be checked, let alone trusted                     | `packages/ledger/src/ledger.ts` write path steps 2-4                            | `server.test.ts` ("rejects a write from a key the ledger has never seen")                                  |
| Confused-deputy / privilege escalation                                | Authentication (`services/api`'s bearer scheme) and ledger trust/authorization are wholly separate evaluations; a bearer token alone authorizes nothing on the ledger               | `services/api/src/plugins/auth.ts`, ADR 0006                                    | `server.test.ts` (unauthenticated requests rejected independently of ledger-level checks)                  |
| Malicious or compromised verifiers                                    | Verification results identify verifier, method, method version, and are never treated as self-certifying — a Verification Report is itself a signed, disputable attestation         | `spec/ACT-1.0.md` section 11.3, `Challenge` artifact type                       | Schema fixtures for `verification-report` and `challenge`                                                  |
| Schema/algorithm downgrade                                            | Closed enumerations reject unrecognized `event_type`/algorithm values rather than reinterpreting them; `additionalProperties: false` throughout                                     | All schemas under `schemas/`                                                    | `validate-schemas.ts` negative fixtures                                                                    |
| Clock manipulation                                                    | `occurred_at` (actor-claimed) and `accepted_at` (ledger-observed) are recorded separately; causal order is established via `causal_parents`/`sequence`, never wall-clock comparison | `spec/ACT-1.0.md` section 5.5, `packages/ledger`                                | `ledger.test.ts` (sequence-based, not time-based, ordering assertions)                                     |
| Unauthorized disclosure / cross-tenant access                         | Tenant field on every event; `services/api` scopes by `x-act-tenant`. Full tenant-isolation enforcement across all read paths is tracked in `docs/roadmap.md`                       | `services/api/src/plugins/auth.ts`                                              | Partial; full cross-tenant denial test suite is a roadmap item                                             |
| Content substitution / evidence deletion                              | Content descriptors carry a digest independent of storage location; deletion changes `availability_state` via a new signed event, never silently                                    | `schemas/common/content-descriptor.schema.json`                                 | Schema fixtures; full redaction-flow tests tracked in `docs/roadmap.md`                                    |
| Partial-history / omission attacks                                    | Missing parents are an explicit, queryable boundary (`LineageResult.boundaries`), not silently absent                                                                               | `packages/ledger/src/ledger.ts` (`getLineage`)                                  | `ledger.test.ts`, `lineage.test.ts`                                                                        |
| Denial of service / oversized payloads                                | Fastify `bodyLimit` (2 MB default) and `@fastify/rate-limit` (200 req/min default) on every route                                                                                   | `services/api/src/server.ts`                                                    | Configuration present; load-test baseline is a roadmap item                                                |
| Webhook forgery/replay                                                | Not yet applicable — this release does not implement outbound webhooks                                                                                                              | —                                                                               | Tracked in `docs/roadmap.md`                                                                               |
| Dependency/build/tool supply-chain compromise                         | Lockfile-pinned dependencies (`pnpm-lock.yaml`); no dependency ships with a known critical/high vulnerability at time of writing (spot-checked via `pnpm audit`)                    | `pnpm-lock.yaml`                                                                | Manual `pnpm audit` run; automated SBOM/scan-in-CI is a roadmap item                                       |

## Residual Risk

- Tenant isolation, full redaction-flow testing, webhook security, load
  testing, and an automated SBOM/dependency-scan gate are not complete in
  this release; each is listed explicitly in `docs/roadmap.md` rather than
  claimed as done.
- The API's trust-bootstrap model (ADR 0006) grants ledger trust to any
  caller who can prove possession of a keypair, with no organizational
  vetting — an intentional Phase 1 simplification, not an oversight, but
  a real residual risk for any deployment that needs gated admission.
- `apps/cli`'s plaintext local private-key storage is a residual risk by
  design for a local development tool; it must not be used to hold a
  production signing key.
