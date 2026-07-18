# API Reference

The authoritative machine-readable contract is `services/api/openapi/act-v1.yaml` (OpenAPI 3.1). This document is a human-oriented index linking each operation to its handler and its test coverage; if the two disagree, the OpenAPI document and the handler code are authoritative, and this file should be corrected.

Request bodies for every write endpoint are DSSE-compatible signed event envelopes (`schemas/envelope/signed-envelope.schema.json` wrapping `schemas/event/unsigned-event.schema.json`), constructed and signed client-side — see `packages/sdk-typescript`'s `buildUnsignedEvent` and `@act/crypto`'s `signEnvelope`. The server never signs on a caller's behalf.

| Operation | Handler | Auth/trust notes |
| --- | --- | --- |
| `GET /v1/health/live`, `/ready` | `services/api/src/routes/health.ts` | No authentication required |
| `GET /v1/schemas` | `services/api/src/routes/schemas.ts` | No authentication required |
| `POST /v1/keys` | `services/api/src/routes/keys.ts` | Trust bootstrap: verifies embedded public key produces the signature (ADR 0006) |
| `POST /v1/actors` | `services/api/src/routes/actors.ts` | Requires the signing key already registered via `/v1/keys` |
| `POST /v1/intents` | `services/api/src/routes/intents.ts` | Requires a registered, trusted signing key |
| `POST /v1/transformations` | `services/api/src/routes/transformations.ts` | ditto |
| `POST /v1/artifacts`, `GET /v1/artifacts/{id}`, `GET /v1/artifacts/{id}/versions` | `services/api/src/routes/artifacts.ts` | ditto |
| `POST /v1/approval-requests`, `POST /v1/approval-decisions`, `GET /v1/approvals/{id}` | `services/api/src/routes/approvals.ts` | ditto |
| `POST /v1/challenges` | `services/api/src/routes/challenges.ts` | ditto |
| `POST /v1/verifications`, `GET /v1/verifications/{id}` | `services/api/src/routes/verifications.ts` | ditto |
| `POST /v1/policies` | `services/api/src/routes/policies.ts` | ditto |
| `GET /v1/lineage/{id}`, `GET /v1/history/{id}` | `services/api/src/routes/lineage.ts` | Read-only; returns explained findings (missing-parent boundaries, truncation) alongside the raw traversal, via `packages/verification`'s `checkLineageCompleteness` |
| `GET /v1/events` | `services/api/src/routes/events.ts` | Cursor-paginated (`cursor` = last sequence number) |
| `POST /v1/bundles/export`, `POST /v1/bundles/import`, `GET /v1/quarantine` | `services/api/src/routes/bundles.ts` | Import re-runs the same proof-of-possession bootstrap per `Key` artifact event encountered (ADR 0006); invalid events are quarantined, not silently dropped |
| `POST /v1/federation/peers`, `GET /v1/federation/peers`, `DELETE /v1/federation/peers/{peerId}` | `services/api/src/routes/federation.ts` | Registers/lists/removes a peer ledger's URL; registering a peer grants it no trust by itself |
| `POST /v1/federation/pull`, `POST /v1/federation/push` | `services/api/src/routes/federation.ts` | Real peer-to-peer transport over HTTP: pulls a peer's `/v1/bundles/export` output through the same import path as `/v1/bundles/import` (`services/api/src/bundle-ops.ts`), or pushes this ledger's export to a peer's import endpoint. `pull` also returns `findings.forks` (informational branches) and `findings.equivocations` (adversarial: same reviewer key issuing conflicting decisions over the identical subject+policy) via `@act/ledger`'s `Ledger.findForks`/`findEquivocations` — neither is a hard reject |

All error responses are RFC 9457 Problem Details (`services/api/src/problem.ts`, `services/api/src/plugins/error-handler.ts`) with a stable `code` field — see the table in `services/api/src/plugins/error-handler.ts`'s `LEDGER_ERROR_STATUS` map for the ledger-originated codes (`schema_invalid`, `digest_mismatch`, `invalid_signature`, `untrusted_actor`, `missing_parent`, `cycle_detected`) and `services/api/src/problem.ts` for API-originated ones.

## End-to-End Example

`services/api/src/__tests__/server.test.ts` is the canonical worked example: it registers a key and actor, submits an Intent, records a two-input Transformation, runs a full approval-request/decision/challenge/ verification/policy cycle, paginates events, and exports/imports a bundle into a second independent ledger — all against the real handlers, not mocks.
