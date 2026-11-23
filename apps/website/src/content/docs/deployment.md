---
title: Deployment
description: Running ACT as a full local stack via Docker Compose, or in Kubernetes via the Helm chart.
---

Two deployment shapes exist under `deploy/`, both built from the same hardened, non-root, multi-stage Dockerfiles (`deploy/docker/api.Dockerfile`, `deploy/docker/explorer.Dockerfile`):

- **`deploy/compose/`**: a full local/demo stack via Docker Compose.
- **`deploy/helm/act/`**: a Helm chart for a production-shaped Kubernetes deployment.

## Local stack topology

```bash
docker compose -f deploy/compose/docker-compose.yml up --build
```

```mermaid
flowchart LR
    Op(["Operator / browser"])
    Explorer["explorer\n(nginx, static build)"]
    API["api\nservices/api"]
    PG[("postgres\nPostgreSQL 16")]
    OIDC["oidc-provider\ndeterministic dev IdP"]
    Otel["otel-collector"]

    Op --> Explorer
    Op --> API
    Explorer -->|GET /v1/events| API
    API --> PG
    API -.->|discovery + JWKS| OIDC
    Otel -->|scrapes GET /v1/metrics| API
```

Everything here is for local and demo use: fixed development-only credentials, and the OIDC provider mints tokens on request with no real login flow.

| Service | Purpose |
| --- | --- |
| `postgres` | PostgreSQL 16, the API's storage backend |
| `oidc-provider` | A deterministic, offline OIDC issuer (discovery, JWKS, token endpoint) that exercises the API's production OIDC/JWT path without a paid identity provider |
| `api` | `services/api`, `ACT_STORAGE=postgres`, pointed at both of the above |
| `explorer` | The static Vite build of `apps/explorer`, served by nginx |
| `otel-collector` | Scrapes the API's real `GET /v1/metrics` (Prometheus text format) and logs what it collected. A genuinely functioning pipeline, not a placeholder |

:::tip[Exercising OIDC without a paid identity provider]

The `oidc-provider` service is a real, deterministic OIDC issuer, not a mock. Point `ACT_OIDC_ISSUER` at it and the API's production JWT-validation path runs exactly as it would against Okta, Auth0, or Entra ID.

:::

## Environment reference

| Variable | Default | Meaning |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` triggers the fail-closed auth check below |
| `PORT` | `4000` | HTTP port |
| `ACT_STORAGE` | `sqlite` | `sqlite` or `postgres` |
| `ACT_DB_PATH` | `./data/act.db` | SQLite file path (ignored when `ACT_STORAGE=postgres`) |
| `ACT_DATABASE_URL` | — | Required when `ACT_STORAGE=postgres` |
| `ACT_DEV_MODE` | `false` | Enables the local bearer-as-actor-id auth scheme. **Must** be `false` or unset in production; the server refuses to start otherwise |
| `ACT_OIDC_ISSUER` / `ACT_OIDC_AUDIENCE` | — | Required in production (mutually exclusive with `ACT_DEV_MODE`) |
| `ACT_OIDC_JWKS_URI` | discovered from `ACT_OIDC_ISSUER` | Set to skip OIDC discovery |
| `ACT_ADMIN_ACTORS` | — | Comma-separated actor ids (OIDC `sub`) allowed to admit keys, manage federation peers, import bundles, and read the quarantine. An entry `tenant::actor` administers only that tenant; a bare `actor` administers whichever tenant their token names. **Required in production** (the server refuses to start without one); in dev mode, unset means every caller is an administrator |
| `ACT_KEY_REGISTRATION` | `open` in dev mode, `admin` otherwise | `open`: any caller proving possession of a key may register it. `admin`: only administrators may (ADR 0009) |
| `ACT_LEDGER_PRIVATE_KEY` | generated once, stored in the database | Base64 Ed25519 seed for the **default tenant's** receipt-signing key (every other tenant gets its own generated key, stored in the database). Set it to keep the private key out of the database; the server refuses to start if it does not match the key already registered for that database |
| `ACT_REQUIRE_TENANT` | `true` in production, otherwise `false` | Refuse a caller whose credentials name no tenant (OIDC token without the `act_tenant` claim; dev request without `x-act-tenant`) instead of placing them in the `default` tenant (ADR 0010) |
| `ACT_TENANTS` | — | Comma-separated tenant ids that may exist; any other tenant is refused with `403 tenant_not_allowed`. Unset allows any valid tenant id |
| `ACT_MAX_TENANTS` | `1000` | Upper bound on tenants held in memory at once; beyond it new tenants get `503 tenant_limit_reached` |
| `ACT_ALLOW_PRIVATE_PEERS` | `false` (`true` in dev mode) | Permit federation peers on loopback/private/link-local addresses. Leave off in production: it is the SSRF guard |
| `ACT_AUTHORITY_POLICY_FILE` | — | Path to a JSON file `{ "policy": <authority policy>, "actorRoles": { "<actor id>": ["role"] } }`. Without it no one may select or merge an effective intent (`authority_policy_required`) |

A ledger's identity (its id and receipt-signing key) is created once and stored in its database, so every replica of one database shares it and a restart keeps it. Peers pin it out of band via `GET /v1/ledger`. Egress policy is the complete defense against SSRF through federation peers: the API re-resolves a peer's host before each call and refuses redirects, but a network policy limiting outbound traffic to known peers closes the remaining DNS-rebinding race.

`NODE_ENV=production` fails closed at startup unless exactly one of `ACT_DEV_MODE=true` (never in production) or both OIDC variables are set. See `services/api/src/server.ts`.

## Tenants

Every tenant is a separate ledger inside the one database: its own ledger id, receipt-signing key, receipt chain, key registry, peers and quarantine (ADR 0010). Tenants are created on first use from the `act_tenant` claim of an authenticated token. An existing single-tenant deployment is simply the `default` tenant: its ledger id, key, history and peers are unchanged, and `ACT_LEDGER_PRIVATE_KEY` still applies to it.

- For more than one tenant, leave `ACT_REQUIRE_TENANT` on (the production default) so a token without the claim is refused rather than placed in `default`, and set `ACT_TENANTS` to the tenants you provision.
- Events must state the caller's tenant (`default` in a single-tenant deployment).
- To share history between tenants, administrators pin each other's ledgers as federation peers and exchange verified bundles, exactly as two separate deployments would. There is no implicit sharing.
- Isolation is logical. Anyone with direct database access sees every tenant, and non-default tenants' signing keys are stored in the database. For stronger separation run a database per tenant (one server each).

## Migrations

`services/api`'s `createLedgerContext` applies pending migrations idempotently on every boot, so no separate step is strictly required. A standalone entrypoint (`pnpm --filter @act/api run migrate`) also exists, so a Helm pre-install or pre-upgrade Job can apply migrations once before any API replica rolls out, rather than relying on whichever replica boots first.

## Helm chart

```bash
helm install act deploy/helm/act \
  --set image.repository=<your-registry>/act-api \
  --set existingSecret=act-db-credentials
```

Secure defaults come out of the box: non-root, read-only root filesystem, dropped capabilities, a `NetworkPolicy`, a `PodDisruptionBudget`, a pre-install migration Job, and an `existingSecret` pattern for the database connection string. No connection string ever lives in a `values.yaml` or a ConfigMap.

## Verifying without a Docker daemon or live cluster

```bash
make verify-deploy
```

This statically validates everything above: `helm lint` and `helm template`, plus `kubeconform` schema validation and `hadolint` Dockerfile linting, all without needing Docker or Kubernetes. CI's `deploy-lint` job additionally runs a real `docker compose ... config` check.

:::note[Why this repo's own sandbox can't run it end-to-end]

This development environment has no usable Docker daemon (WSL2 without the Docker Desktop integration enabled), so the Compose stack and Dockerfiles are statically validated here but not actually built or run in this specific sandbox. CI's `deploy-lint` job, and `make verify-integration`'s real dockerized PostgreSQL run, are the actual proof. See `scripts/integration-smoke.ts` for the exact HTTP smoke sequence it exercises against a real, containerized `services/api`.

:::
