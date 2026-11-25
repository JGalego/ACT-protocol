# ADR 0003: Schema-Generated Domain Types, Not Hand-Written Duplicates

## Status

Accepted

## Context

`PROMPT.md` requires schema-derived domain definitions. The schemas cover artifacts, events, envelopes, receipts, policies, approvals, challenges, and federation. Separate hand-maintained interfaces would risk diverging from runtime validation.

## Decision

`scripts/generate-schema-types.mjs` compiles every schema under `schemas/` into `packages/core/src/generated/domain.ts` using `json-schema-to-typescript`. Each schema is fully dereferenced and compiled independently, then wrapped in its own TypeScript `namespace` so that shared sub-schema names (`ActorRef`, `Digest`, `ArtifactEnvelope`, etc.) can be declared once per namespace without colliding with the same names declared for a different schema; the schema's own top-level type is then re-exported at module scope under its natural name (e.g. `Intent`, `Transformation`, `UnsignedEvent`).

`scripts/generate-artifact-types.mjs` generates artifact-type schemas and fixtures from a shared table of `{name, required, properties, example}` entries. Each schema wraps `artifact-envelope.schema.json`. Adding a type requires a table entry; the generator emits its schema and positive/negative fixtures.

Both generators are re-run via `pnpm run generate:types` and `pnpm run generate:artifact-types`; their output is committed (for IDE/type-check performance) but is fully reproducible from the schemas and generator scripts alone.

## Consequences

- Ajv validates against the schemas used to generate TypeScript types. Regenerating after schema changes keeps compile-time types aligned with runtime validation.
- Compiling the schemas as a single synthetic document produced inconsistent names. Per-schema namespaces avoid those collisions, at the cost of repeated private types such as `ActorRef`.
- OpenAPI-to-client generation for `services/api` is not yet implemented; `packages/sdk-typescript` is hand-written against the same route shapes documented in `services/api/openapi/act-v1.yaml`, tracked as a roadmap item in `docs/roadmap.md`.
