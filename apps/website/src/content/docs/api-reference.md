---
title: API Reference
description: The /v1 operations implemented by the reference ACT API service, and how they're authenticated.
---

The authoritative machine-readable contract is [`services/api/openapi/act-v1.yaml`](https://github.com/JGalego/ACT-protocol/blob/main/services/api/openapi/act-v1.yaml) (OpenAPI 3.1). This page is a human-oriented index linking each operation to its handler; if the two disagree, the OpenAPI document and the handler code are authoritative.

Every write honours an `Idempotency-Key` header: a retry that re-signs the same event replays the original receipt, while the same key on a different event is `409 idempotency_conflict`.

Request bodies for every write endpoint are DSSE-compatible signed event envelopes (`schemas/envelope/signed-envelope.schema.json` wrapping `schemas/event/unsigned-event.schema.json`), constructed and signed client-side. See `packages/sdk-typescript`'s `buildUnsignedEvent` and `@act/crypto`'s `signEnvelope`. The server never signs on a caller's behalf.

| Operation | Handler | Auth/trust notes |
| --- | --- | --- |
| `GET /v1/health/live`, `/ready` | `services/api/src/routes/health.ts` | No authentication required |
| `GET /v1/ledger` | `services/api/src/routes/health.ts` | This ledger's public identity (id, receipt-signing key); what a peer operator pins out of band |
| `GET /v1/ledger` | `services/api/src/routes/health.ts` | This ledger's public identity (id, receipt-signing key); what a peer operator pins out of band |
| `GET /v1/schemas` | `services/api/src/routes/schemas.ts` | No authentication required |
| `POST /v1/keys` | `services/api/src/routes/keys.ts` | Trust bootstrap: the key id must be the fingerprint of the public key, the actor must own the key, and the key must sign its own registration (ADR 0006, ADR 0009). Administrator-only when `ACT_KEY_REGISTRATION=admin` (production default). Also accepts `key_rotated` / `key_revoked` / `key_compromised` events from a trusted key of the same owner |
| `POST /v1/actors` | `services/api/src/routes/actors.ts` | Requires the signing key already registered via `/v1/keys` |
| `POST /v1/intents` | `services/api/src/routes/intents.ts` | Requires a registered, trusted signing key that belongs to the event's actor and signed the event. `intent_effective_selected` / `intent_merged` additionally require an authority policy (`ACT_AUTHORITY_POLICY_FILE`) that the signers satisfy |
| `POST /v1/transformations` | `services/api/src/routes/transformations.ts` | ditto |
| `POST /v1/artifacts`, `GET /v1/artifacts/{id}`, `GET /v1/artifacts/{id}/versions` | `services/api/src/routes/artifacts.ts` | ditto. The artifact's `version_id` is recomputed and its authoring signature verified. `GET /v1/artifacts/{id}` is computed from lineage: `currentVersionId` is `null` and `conflict` is `true` while competing revisions exist (`tips` lists each); `effectiveVersionId` is the authority-selected baseline |
| `POST /v1/approval-requests`, `POST /v1/approval-decisions`, `GET /v1/approvals/{id}` | `services/api/src/routes/approvals.ts` | ditto. The lifecycle of `spec/state-machines.md` section 2 is enforced at write time: a decision needs an existing request for the same subject, must name its own signer as reviewer, and a reviewer decides a request once; only an approved decision can be revoked or expire |
| `POST /v1/challenges` | `services/api/src/routes/challenges.ts` | ditto |
| `POST /v1/verifications`, `GET /v1/verifications/{id}` | `services/api/src/routes/verifications.ts` | ditto |
| `POST /v1/policies` | `services/api/src/routes/policies.ts` | ditto |
| `GET /v1/lineage/{id}`, `GET /v1/history/{id}` | `services/api/src/routes/lineage.ts` | Read-only; returns explained findings (missing-parent boundaries, truncation) alongside the raw traversal, via `packages/verification`'s `checkLineageCompleteness` |
| `GET /v1/artifacts/{id}/diff?from=&to=` | `services/api/src/routes/artifacts.ts` | Read-only; structural diff between two artifact versions |
| `GET /v1/events?eventType=&subjectKind=&cursor=&limit=` | `services/api/src/routes/events.ts` | `limit` (1-500) and `cursor` are validated strictly (`400 invalid_query_param`). Cursor-paginated (`cursor` = last sequence number); filters run against real storage-layer queries, not an in-memory scan |
| `GET /v1/challenges?cursor=&limit=` | `services/api/src/routes/challenges.ts` | Cursor-paginated, pre-filtered to challenge event types |
| `GET /v1/metrics` | `services/api/src/routes/health.ts` | Prometheus text format; scraped by the OpenTelemetry Collector in `deploy/compose/` |
| `POST /v1/bundles/export`, `POST /v1/bundles/import`, `GET /v1/quarantine` | `services/api/src/routes/bundles.ts` | Export computes `completeness` and lists its `known_gaps`. Import and quarantine listing are administrator-only; import verifies the bundle id, its signature against the peer's pinned key, and every source receipt before reading an event, tolerates a missing parent only where the bundle declares the gap, and quarantines (never drops) anything that fails |
| `POST /v1/federation/peers`, `GET /v1/federation/peers`, `DELETE /v1/federation/peers/{id}` | `services/api/src/routes/federation.ts` | Administrator-only. Registering a peer is an explicit trust decision that pins its ledger id and signing key; the URL is checked against loopback/private/link-local targets; bearer tokens are stored but never returned |
| `POST /v1/federation/pull`, `POST /v1/federation/push` | `services/api/src/routes/federation.ts` | Real network transport. Fetches or sends a signed bundle to a registered peer over HTTP and re-verifies it against local trust policy on receipt; see [Deployment](/deployment/) |

All error responses are RFC 9457 Problem Details (`services/api/src/problem.ts`, `services/api/src/plugins/error-handler.ts`) with a stable `code` field. See the `LEDGER_ERROR_STATUS` map for ledger-originated codes (`schema_invalid`, `digest_mismatch`, `invalid_signature`, `actor_key_not_signer`, `untrusted_actor`, `missing_signature`, `missing_parent`, `duplicate_parent`, `cycle_detected`, `artifact_exists`, `idempotency_conflict`) and `services/api/src/problem.ts` for API-originated ones.

## End-to-end example

[`services/api/src/__tests__/server.test.ts`](https://github.com/JGalego/ACT-protocol/blob/main/services/api/src/__tests__/server.test.ts) is the canonical worked example. It registers a key and actor, submits an Intent, records a two-input Transformation, runs a full approval-request/decision/challenge/verification/policy cycle, paginates events, and exports and imports a bundle into a second independent ledger, all against the real handlers, not mocks.
