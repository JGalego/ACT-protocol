# Deployment

Deployment options under `deploy/`:

- `deploy/compose/`: a local/demo stack using Docker Compose.
- `deploy/helm/act/`: a Kubernetes Helm chart.

The multi-stage Dockerfiles produce non-root runtime images: an `act` user for the API and `nginxinc/nginx-unprivileged` for the Explorer. `pnpm deploy` limits the API runtime to its production dependencies.

## Prerequisites

- **Docker Compose stack:** Docker Engine with Compose v2 (`docker compose version`).
- **Helm chart:** `helm` 3.x and a Kubernetes cluster (`kubectl` configured against it).
- **Static validation only** (`make verify-deploy`, no Docker daemon or live cluster required): `helm` is required; `hadolint` (Dockerfile linting) and `kubeconform` (Kubernetes OpenAPI schema validation) run too if present on `PATH`, and are always installed in CI (`.github/workflows/ci.yml`'s `deploy-lint` job) so the full validation runs there even when a contributor's machine lacks them.

During development, static checks passed and `scripts/integration-smoke.ts` ran against the built API with embedded PostgreSQL. That did not validate container builds or a complete Compose deployment. On a Docker host, `make verify-integration` starts PostgreSQL and runs the API's key-registration-to-event-listing smoke sequence over HTTP. CI's `deploy-lint` job checks deployment configuration.

## Running the Full Local Stack

```bash
docker compose -f deploy/compose/docker-compose.yml up --build
```

Brings up:

| Service | Purpose |
| --- | --- |
| `postgres` | PostgreSQL 16, the API's storage backend |
| `oidc-provider` | `services/api/src/oidc/dev-provider.ts`, a deterministic, offline OIDC issuer (discovery, JWKS, token endpoint), for exercising the API's production OIDC/JWT path without a paid identity provider |
| `api` | `services/api`, `ACT_STORAGE=postgres`, pointed at both of the above |
| `explorer` | The static Vite build of `apps/explorer`, served by nginx |
| `otel-collector` | Scrapes `GET /v1/metrics` (Prometheus text format) and writes samples through the `debug` exporter; see `deploy/compose/otel-collector-config.yaml` |

The Compose stack is for local/demo use. It has fixed development credentials, and the OIDC provider issues tokens on request without authenticating users.

## Environment and Configuration Reference

| Variable | Default | Meaning |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` triggers the fail-closed auth check below |
| `PORT` | `4000` | HTTP port |
| `ACT_STORAGE` | `sqlite` | `sqlite` or `postgres` |
| `ACT_DB_PATH` | `./data/act.db` | SQLite file path (ignored when `ACT_STORAGE=postgres`) |
| `ACT_DATABASE_URL` | — | Required when `ACT_STORAGE=postgres` |
| `ACT_DEV_MODE` | `false` | Enables the local bearer-as-actor-id auth scheme (ADR 0006). **Must** be `false`/unset in production; the server refuses to start otherwise |
| `ACT_OIDC_ISSUER` / `ACT_OIDC_AUDIENCE` | — | Required in production (mutually exclusive with `ACT_DEV_MODE`); see ADR 0006's amendment |
| `ACT_OIDC_JWKS_URI` | discovered from `ACT_OIDC_ISSUER` | Set to skip OIDC discovery |
| `ACT_ADMIN_ACTORS` | — | Comma-separated actor ids (OIDC `sub`) allowed to admit keys, manage federation peers, import bundles, and read the quarantine. An entry `tenant::actor` administers only that tenant; a bare `actor` administers whichever tenant their token names. **Required in production** (the server refuses to start without one); in dev mode, unset means every caller is an administrator |
| `ACT_KEY_REGISTRATION` | `open` in dev mode, `admin` otherwise | `open`: any caller proving possession of a key may register it. `admin`: only administrators may (ADR 0009) |
| `ACT_LEDGER_PRIVATE_KEY` | generated once, stored in the database | Base64 Ed25519 seed for the **default tenant's** receipt-signing key (every other tenant gets its own generated key, stored in the database). Set it to keep the private key out of the database; the server refuses to start if it does not match the key already registered for that database |
| `ACT_REQUIRE_TENANT` | `true` in production, otherwise `false` | Refuse a caller whose credentials name no tenant (OIDC token without the `act_tenant` claim; dev request without `x-act-tenant`) instead of placing them in the `default` tenant (ADR 0010) |
| `ACT_TENANTS` | — | Comma-separated tenant ids that may exist; any other tenant is refused with `403 tenant_not_allowed`. Unset allows any valid tenant id |
| `ACT_MAX_TENANTS` | `1000` | Upper bound on tenants held in memory at once; beyond it new tenants get `503 tenant_limit_reached` |
| `ACT_ALLOW_PRIVATE_PEERS` | `false` (`true` in dev mode) | Permit federation peers on loopback/private/link-local addresses. Leave off in production: it is the SSRF guard |
| `ACT_AUTHORITY_POLICY_FILE` | — | Path to a JSON file `{ "policy": <authority policy> }`: which roles may select or merge an effective intent, and the quorum. Who holds a role is not configuration: it comes from signed accountability assignments (`POST /v1/assignments`, ADR 0011), and a file that still has `actorRoles` stops the server from starting. Without it no one may select or merge an effective intent (`authority_policy_required`) |

A ledger's id and receipt-signing key are stored in its database and shared by replicas. Peers pin that identity out of band via `GET /v1/ledger`. The API resolves peer hosts before each call and refuses redirects, but a DNS-rebinding race remains; restrict outbound traffic to known peers at the network layer.

Production requires OIDC configuration and at least one administrator. `ACT_DEV_MODE=true` is rejected in production. See `services/api/src/server.ts`.

## Tenants

Every tenant is a separate ledger inside the one database: its own ledger id, receipt-signing key, receipt chain, key registry, peers and quarantine (ADR 0010). Tenants are created on first use from the `act_tenant` claim of an authenticated token. An existing single-tenant deployment is simply the `default` tenant: its ledger id, key, history and peers are unchanged, and `ACT_LEDGER_PRIVATE_KEY` still applies to it.

- For more than one tenant, leave `ACT_REQUIRE_TENANT` on (the production default) so a token without the claim is refused rather than placed in `default`, and set `ACT_TENANTS` to the tenants you provision.
- Events must state the caller's tenant (`default` in a single-tenant deployment).
- To share history between tenants, administrators pin each other's ledgers as federation peers and exchange verified bundles, exactly as two separate deployments would. There is no implicit sharing.
- Isolation is logical. Anyone with direct database access sees every tenant, and non-default tenants' signing keys are stored in the database. For stronger separation run a database per tenant (one server each).

## Witnesses

To protect against an operator showing different parties different histories, register independent witnesses per tenant (ADR 0013): an administrator calls `POST /v1/witnesses` with each witness's `key_id` (the fingerprint of its public key) and `public_key`. Each witness runs `witnessStep` from `@act/ledger` on a schedule: it fetches `GET /v1/checkpoint`, proves the history extends the last checkpoint it cosigned (receipts from `GET /v1/receipts`), and files its cosignature with `POST /v1/checkpoints/{size}/witness`. Consumers (auditors, peers) verify with `verifyCheckpoint` against their own witness set and a threshold `k`; with `W` witnesses, fewer than `2k - W` may be corrupt. A tenant with no registered witnesses has no more protection than before. Checkpoints are per tenant.

## Migrations and Seeding

`createLedgerContext` (`services/api/src/ledger-context.ts`) applies pending migrations idempotently on every server boot, so no separate step is strictly required. `services/api/src/bin/migrate.ts` (`pnpm --filter @act/api run migrate`, compiled to `dist/bin/migrate.js`) exists as a standalone entrypoint so a Helm pre-install/pre-upgrade Job can apply migrations once before any API replica rolls out, rather than relying on whichever replica boots first (`deploy/helm/act/templates/migration-job.yaml`).

There is no dedicated demo-data seed command. Use the CLI for a local workspace or `POST /v1/bundles/import` for a service ledger. The API scenarios under `examples/` currently run as tests.

## Helm Chart

```bash
helm install act deploy/helm/act \
  --set api.oidc.issuer=https://your-idp.example.com \
  --set 'api.adminActors[0]=your-admin-subject' \
  --set api.oidc.audience=act-api \
  --set api.database.existingSecret=my-db-secret \
  --wait
```

Secure defaults: non-root, read-only root filesystem, all Linux capabilities dropped, `seccompProfile: RuntimeDefault`, no auto-mounted service account token, a `NetworkPolicy` per component (default-scoped to same-namespace ingress; see the chart's comments for what to tighten once your Postgres/IdP endpoints are known), and a `PodDisruptionBudget` per component. `api.database.connectionString` (a literal value, rendered into a chart-managed Secret) exists only for quick local/demo installs. `api.database.existingSecret` is the recommended production path, referencing a Secret you manage outside this chart (e.g. via your cluster's secrets manager integration).

See `deploy/helm/act/values.yaml` for the full set of configurable values (replica counts, resources, probes, ingress hosts, etc.) and `helm template`'s rendered `NOTES.txt` for post-install pointers.
