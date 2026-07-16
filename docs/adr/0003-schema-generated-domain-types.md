# ADR 0003: Schema-Generated Domain Types, Not Hand-Written Duplicates

## Status

Accepted

## Context

`PROMPT.md`'s technology-stack section requires: "Avoid duplicating
authoritative domain definitions: generate language models and API
clients from the JSON Schemas and OpenAPI document where practical." With
46 schemas (28 artifact types plus events, envelopes, receipts, policies,
approvals, challenges, and the federation bundle), hand-writing and
hand-maintaining a parallel set of TypeScript interfaces would
immediately drift from the schemas that are actually enforced at runtime.

## Decision

`scripts/generate-schema-types.mjs` compiles every schema under `schemas/`
into `packages/core/src/generated/domain.ts` using
`json-schema-to-typescript`. Each schema is fully dereferenced and
compiled independently, then wrapped in its own TypeScript `namespace` so
that shared sub-schema names (`ActorRef`, `Digest`, `ArtifactEnvelope`,
etc.) can be declared once per namespace without colliding with the same
names declared for a different schema; the schema's own top-level type is
then re-exported at module scope under its natural name (e.g. `Intent`,
`Transformation`, `UnsignedEvent`).

`scripts/generate-artifact-types.mjs` is the companion generator for the
28 concrete artifact-type schemas themselves (`schemas/artifact/types/`):
each is derived from one shared table of `{name, required, properties,
example}` entries, wrapping the shared `artifact-envelope.schema.json`,
so that adding a 29th artifact type is a table entry, not a hand-authored
schema file plus a hand-authored type plus hand-authored fixtures (the
generator also emits one positive and one negative fixture per type).

Both generators are re-run via `pnpm run generate:types` and `pnpm run
generate:artifact-types`; their output is committed (for IDE/type-check
performance) but is fully reproducible from the schemas and generator
scripts alone.

## Consequences

- Ajv (`packages/core/src/validate.ts`) remains the single source of
  runtime truth; the generated TypeScript types are a compile-time
  convenience that can never silently diverge from what is actually
  validated, because both are compiled from the same schema files.
- The namespace-wrapping approach was adopted after an earlier attempt
  (bundling all 46 schemas into one synthetic document and compiling it
  in a single pass) produced internally inconsistent naming across such a
  large combined reference graph; per-schema namespacing trades a small
  amount of type duplication (each namespace has its own private copy of
  `ActorRef`) for guaranteed internal consistency.
- OpenAPI-to-client generation for `services/api` is not yet implemented;
  `packages/sdk-typescript` is hand-written against the same route shapes
  documented in `services/api/openapi/act-v1.yaml`, tracked as a roadmap
  item in `docs/roadmap.md`.
