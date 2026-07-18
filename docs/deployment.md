# Deployment

Two deployment shapes exist, both under `deploy/`:

- `deploy/compose/` — a full local/demo stack via Docker Compose.
- `deploy/helm/act/` — a Helm chart for a production-shaped Kubernetes deployment.

Both build from `deploy/docker/api.Dockerfile` and `deploy/docker/explorer.Dockerfile`: hardened multi-stage builds that produce non-root runtime images (a dedicated `act` user for the API; `nginxinc/nginx-unprivileged` for the Explorer), using `pnpm deploy` to prune the built API image down to production dependencies only -- no monorepo tooling, no other workspace package's source, no devDependencies.

## Prerequisites

- **Docker Compose stack:** Docker Engine with Compose v2 (`docker compose version`).
- **Helm chart:** `helm` 3.x and a Kubernetes cluster (`kubectl` configured against it).
- **Static validation only** (`make verify-deploy`, no Docker daemon or live cluster required): `helm` is required; `hadolint` (Dockerfile linting) and `kubeconform` (Kubernetes OpenAPI schema validation) run too if present on `PATH`, and are always installed in CI (`.github/workflows/ci.yml`'s `deploy-lint` job) so the full validation runs there even when a contributor's machine lacks them.

This repository's own development sandbox has no usable Docker daemon (WSL2 without the Docker Desktop integration enabled), so `deploy/compose/*.yml` and the Dockerfiles are validated statically here (`docker compose ... config`, `helm template` + `kubeconform`, `hadolint`) but have not been built or run end-to-end in this environment. `make verify-integration`'s and CI's `deploy-lint` job's real, dockerized runs are the actual proof; see `scripts/integration-smoke.ts` for what the former exercises (a real key-registration → event-listing sequence against the actual built `services/api` server, over HTTP, backed by a real containerized PostgreSQL -- verified working during development against a local embedded-postgres server standing in for the container).

## Running the Full Local Stack

```bash
docker compose -f deploy/compose/docker-compose.yml up --build
```

Brings up:

| Service | Purpose |
| --- | --- |
| `postgres` | PostgreSQL 16, the API's storage backend |
| `oidc-provider` | `services/api/src/oidc/dev-provider.ts` -- a deterministic, offline OIDC issuer (discovery, JWKS, token endpoint), for exercising the API's production OIDC/JWT path without a paid identity provider |
| `api` | `services/api`, `ACT_STORAGE=postgres`, pointed at both of the above |
| `explorer` | The static Vite build of `apps/explorer`, served by nginx |
| `otel-collector` | Scrapes the API's real `GET /v1/metrics` (Prometheus text format) and logs what it collected via the `debug` exporter -- a genuinely functioning pipeline, not a placeholder; see `deploy/compose/otel-collector-config.yaml` |

Everything here is for local/demo use: fixed development-only credentials, and the OIDC provider mints tokens on request with no real login flow.

## Environment and Configuration Reference

| Variable | Default | Meaning |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` triggers the fail-closed auth check below |
| `PORT` | `4000` | HTTP port |
| `ACT_STORAGE` | `sqlite` | `sqlite` or `postgres` |
| `ACT_DB_PATH` | `./data/act.db` | SQLite file path (ignored when `ACT_STORAGE=postgres`) |
| `ACT_DATABASE_URL` | — | Required when `ACT_STORAGE=postgres` |
| `ACT_DEV_MODE` | `false` | Enables the local bearer-as-actor-id auth scheme (ADR 0006). **Must** be `false`/unset in production -- the server refuses to start otherwise |
| `ACT_OIDC_ISSUER` / `ACT_OIDC_AUDIENCE` | — | Required in production (mutually exclusive with `ACT_DEV_MODE`); see ADR 0006's amendment |
| `ACT_OIDC_JWKS_URI` | discovered from `ACT_OIDC_ISSUER` | Set to skip OIDC discovery |

`NODE_ENV=production` fails closed at startup unless exactly one of `ACT_DEV_MODE=true` (never in production) or both OIDC variables are set -- see `services/api/src/server.ts`.

## Migrations and Seeding

`createLedgerContext` (`services/api/src/ledger-context.ts`) applies pending migrations idempotently on every server boot, so no separate step is strictly required. `services/api/src/bin/migrate.ts` (`pnpm --filter @act/api run migrate`, compiled to `dist/bin/migrate.js`) exists as a standalone entrypoint so a Helm pre-install/pre-upgrade Job can apply migrations once before any API replica rolls out, rather than relying on whichever replica boots first (`deploy/helm/act/templates/migration-job.yaml`).

There is no dedicated demo-data seed script yet. `apps/cli`'s `act` commands or `POST /v1/bundles/import` can load events into a running ledger; the seeded example applications tracked in `docs/roadmap.md` (Example Applications) are the natural home for real seed fixtures once built.

## Helm Chart

```bash
helm install act deploy/helm/act \
  --set api.oidc.issuer=https://your-idp.example.com \
  --set api.oidc.audience=act-api \
  --set api.database.existingSecret=my-db-secret \
  --wait
```

Secure defaults: non-root, read-only root filesystem, all Linux capabilities dropped, `seccompProfile: RuntimeDefault`, no auto-mounted service account token, a `NetworkPolicy` per component (default-scoped to same-namespace ingress; see the chart's comments for what to tighten once your Postgres/IdP endpoints are known), and a `PodDisruptionBudget` per component. `api.database.connectionString` (a literal value, rendered into a chart-managed Secret) exists only for quick local/demo installs -- `api.database.existingSecret` is the recommended production path, referencing a Secret you manage outside this chart (e.g. via your cluster's secrets manager integration).

See `deploy/helm/act/values.yaml` for the full set of configurable values (replica counts, resources, probes, ingress hosts, etc.) and `helm template`'s rendered `NOTES.txt` for post-install pointers.
