# ADR 0010: Tenant Isolation: One Ledger per Tenant

## Status

Accepted. Amends ADR 0004 and ADR 0008 (storage), ADR 0006 (authentication) and ADR 0009 (key registry, ledger identity, peers, administrators).

## Context

Every event carries a `tenant` field and the API parses `x-act-tenant` (development) or the OIDC `act_tenant` claim, but nothing downstream uses either. All callers share one ledger: one hash chain, one signing key, one key registry, one peer list, one quarantine, and storage queries that are not scoped to anything. `spec/conformance.md` lists tenant isolation as a requirement of the Secure Service profile, and `docs/threat-model.md` lists cross-tenant disclosure as a known gap.

Reading the code against that requirement shows that a `WHERE tenant = ?` filter on a shared ledger would not be enough:

- **Metadata leaks through the shared chain.** Sequence numbers and `previous_receipt_digest` are global, so each tenant sees gaps where other tenants' events sit and can count their activity. A tenant's export would also be a chain with holes that no peer could verify.
- **Existence oracles.** `events.event_id`, `heads.artifact_id` and `causal_parents` are keyed globally. Submitting an event another tenant already holds returns that tenant's receipt (`duplicate: true`) or a conflict, which confirms the other tenant has it.
- **Trust bleeds across tenants.** The key registry is one projection of one log. A key registered by tenant A is trusted when tenant B submits, and key-id and actor-id collisions are resolved against the other tenant's state.
- **Operator state is shared.** Peers, pinned ledger identities and the quarantine list are global, so one tenant's administrator manages every tenant's federation.
- **Tenant is unauthenticated data.** `tenantId` falls back to `'default'`, accepts any string in development, and is never compared with the `tenant` inside the signed event.

## Decision

**A tenant is a ledger.** Each tenant has its own ledger id, receipt-signing key, receipt hash chain, key registry, peer registry, quarantine list and heads. Tenants share a database and a process and nothing else. The schema already identifies events and receipts by `(ledger_id, sequence)`, so this fits the existing model, and a tenant's chain, bundle export and verification are exactly those of a standalone ledger. No tenant can see another's sequence numbers, and a tenant can be exported, verified, or moved to its own database without touching the rest.

**Tenant identity is derived from authentication only.** The tenant is the OIDC claim (production) or `x-act-tenant` header (development), never a request body field. It must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`; anything else is `400`. With `ACT_REQUIRE_TENANT=true` (the default when `NODE_ENV=production`) a token without the claim is rejected instead of falling back to `default`. `ACT_TENANTS` (comma-separated) optionally restricts the tenants that may exist; an unlisted tenant is `403`. Tenant contexts are created lazily on first use and are cached; the number of live tenants is bounded by `ACT_MAX_TENANTS` (default 1000) so a compromised issuer cannot allocate unbounded state.

**The event states its tenant, and it must be right.** The `tenant` in a signed event must equal the authenticated tenant. `not_applicable` is refused: a tenant-scoped ledger holds events that say which tenant they belong to, so a signature can never be replayed into another tenant's ledger. The one exception is a federation import, which carries events authored on another ledger (their own tenant field, their own source receipt) into the local tenant's ledger.

**Storage is scoped by construction, not by convention.** Every `StorageAdapter` method takes the ledger id, so a caller cannot forget to scope a query (the compiler enforces it). Migration `0003-tenant-scoping` re-keys `events`, `causal_parents`, `heads` and `quarantine` by ledger id (`(ledger_id, event_id)`, `(ledger_id, event_id, parent_event_id)`, `(ledger_id, artifact_id)`), back-filling existing rows into the single ledger they belong to. Two tenants may therefore hold byte-identical events (for example the same imported bundle) without colliding, and neither learns of the other.

**Per-tenant metadata is namespaced.** Ledger identity, peers and other `ledger_meta` entries are stored under a per-tenant key prefix; the `default` tenant keeps the unprefixed legacy keys, so an existing single-tenant deployment is simply the `default` tenant with its existing ledger id, key, chain and peers. `ACT_LEDGER_PRIVATE_KEY` applies to the `default` tenant only. Other tenants get a generated key stored in the database (as ADR 0009 does for the default ledger).

**Administration is scoped to the tenant.** An administrator administers the tenant their token names. `ACT_ADMIN_ACTORS` entries are either `actor` (administrator in whichever tenant their token names, the existing meaning) or `tenant::actor` (administrator only in that tenant). Peers, imports and quarantine operate on the caller's tenant only.

**A cross-tenant reference looks like a missing one.** Reading, diffing, tracing the lineage of, or submitting a parent from another tenant behaves exactly as if the object did not exist (`404` or `missing_parent`). The API never answers `403` or `409` for something that exists only in another tenant, because that would be an existence oracle.

**Sharing between tenants is explicit.** Two tenants in one deployment exchange events the way two ledgers do: through a verified federation bundle between their ledgers, pinned by an administrator on each side. There is no implicit sharing and no cross-tenant read path.

## Verification

The properties are model-checked in `formal/modules/TenantIsolation.tla` (an adversarial tenant that submits, reads and imports against a shared store, with mutants for each guard: unscoped read, unscoped write, shared sequence counter, unchecked event tenant, shared key registry, global event id) and exercised against the real API by a cross-tenant denial suite and by the model-based test.

## Consequences

- Cross-tenant disclosure through the API, through duplicate detection, through key trust and through the receipt chain is closed. Existing deployments keep working as the `default` tenant, with one breaking change: events must now state a tenant equal to the caller's (`default` in single-tenant deployments), and production requires the tenant claim unless `ACT_REQUIRE_TENANT=false`.
- Isolation is logical, inside one database. Anyone with direct database access sees every tenant, and all per-tenant signing keys are in the same database unless supplied another way. Per-tenant database or KMS-held keys are an operator hardening step, not something this ADR provides.
- Side channels are out of scope: response timing, rate-limit sharing and resource exhaustion by a single tenant are not isolated here. Rate limiting is still per client address; per-tenant quotas are future work.
- A tenant cannot be deleted without deleting its ledger, which is append-only by design; retirement means stopping access and exporting.
- Operating many tenants costs one in-memory key registry and one ledger object each, rebuilt from that tenant's log at first use.
