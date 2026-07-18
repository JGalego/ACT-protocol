---
title: API Reference
description: The /v1 operations implemented by the reference ACT API service, and how they're authenticated.
---

The authoritative machine-readable contract is [`services/api/openapi/act-v1.yaml`](https://github.com/JGalego/ACT-protocol/blob/main/services/api/openapi/act-v1.yaml) (OpenAPI 3.1). This page is a human-oriented index linking each operation to its handler; if the two disagree, the OpenAPI document and the handler code are authoritative.

Request bodies for every write endpoint are DSSE-compatible signed event envelopes (`schemas/envelope/signed-envelope.schema.json` wrapping `schemas/event/unsigned-event.schema.json`), constructed and signed client-side. See `packages/sdk-typescript`'s `buildUnsignedEvent` and `@act/crypto`'s `signEnvelope`. The server never signs on a caller's behalf.

| Operation | Handler | Auth/trust notes |
| --- | --- | --- |
| `GET /v1/health/live`, `/ready` | `services/api/src/routes/health.ts` | No authentication required |
| `GET /v1/schemas` | `services/api/src/routes/schemas.ts` | No authentication required |
| `POST /v1/keys` | `services/api/src/routes/keys.ts` | Trust bootstrap: verifies the embedded public key produces the signature (ADR 0006) |
| `POST /v1/actors` | `services/api/src/routes/actors.ts` | Requires the signing key already registered via `/v1/keys` |
| `POST /v1/intents` | `services/api/src/routes/intents.ts` | Requires a registered, trusted signing key |
| `POST /v1/transformations` | `services/api/src/routes/transformations.ts` | ditto |
| `POST /v1/artifacts`, `GET /v1/artifacts/{id}`, `GET /v1/artifacts/{id}/versions` | `services/api/src/routes/artifacts.ts` | ditto |
| `POST /v1/approval-requests`, `POST /v1/approval-decisions`, `GET /v1/approvals/{id}` | `services/api/src/routes/approvals.ts` | ditto |
| `POST /v1/challenges` | `services/api/src/routes/challenges.ts` | ditto |
| `POST /v1/verifications`, `GET /v1/verifications/{id}` | `services/api/src/routes/verifications.ts` | ditto |
| `POST /v1/policies` | `services/api/src/routes/policies.ts` | ditto |
| `GET /v1/lineage/{id}`, `GET /v1/history/{id}` | `services/api/src/routes/lineage.ts` | Read-only; returns explained findings (missing-parent boundaries, truncation) alongside the raw traversal, via `packages/verification`'s `checkLineageCompleteness` |
| `GET /v1/artifacts/{id}/diff?from=&to=` | `services/api/src/routes/artifacts.ts` | Read-only; structural diff between two artifact versions |
| `GET /v1/events?eventType=&subjectKind=&cursor=&limit=` | `services/api/src/routes/events.ts` | Cursor-paginated (`cursor` = last sequence number); filters run against real storage-layer queries, not an in-memory scan |
| `GET /v1/challenges?cursor=&limit=` | `services/api/src/routes/challenges.ts` | Cursor-paginated, pre-filtered to challenge event types |
| `GET /v1/metrics` | `services/api/src/routes/health.ts` | Prometheus text format; scraped by the OpenTelemetry Collector in `deploy/compose/` |
| `POST /v1/bundles/export`, `POST /v1/bundles/import`, `GET /v1/quarantine` | `services/api/src/routes/bundles.ts` | Import re-runs the same proof-of-possession bootstrap per `Key` artifact event encountered (ADR 0006); invalid events are quarantined, not silently dropped |
| `POST /v1/federation/peers`, `GET /v1/federation/peers`, `DELETE /v1/federation/peers/{id}` | `services/api/src/routes/federation.ts` | Registers/lists/removes peer ledgers this instance can pull from or push to |
| `POST /v1/federation/pull`, `POST /v1/federation/push` | `services/api/src/routes/federation.ts` | Real network transport. Fetches or sends a signed bundle to a registered peer over HTTP and re-verifies it against local trust policy on receipt; see [Deployment](/deployment/) |

All error responses are RFC 9457 Problem Details (`services/api/src/problem.ts`, `services/api/src/plugins/error-handler.ts`) with a stable `code` field. See the `LEDGER_ERROR_STATUS` map for ledger-originated codes (`schema_invalid`, `digest_mismatch`, `invalid_signature`, `untrusted_actor`, `missing_parent`, `cycle_detected`) and `services/api/src/problem.ts` for API-originated ones.

## End-to-end example

[`services/api/src/__tests__/server.test.ts`](https://github.com/JGalego/ACT-protocol/blob/main/services/api/src/__tests__/server.test.ts) is the canonical worked example. It registers a key and actor, submits an Intent, records a two-input Transformation, runs a full approval-request/decision/challenge/verification/policy cycle, paginates events, and exports and imports a bundle into a second independent ledger, all against the real handlers, not mocks.
