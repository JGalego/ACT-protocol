---
title: Design Decisions
description: Release scope, canonicalization, semantic assessment, trust bootstrap, and storage decisions.
---

Architecture Decision Records under [`docs/adr/`](https://github.com/JGalego/ACT-protocol/tree/main/docs/adr) document implementation choices, their rationale, and their consequences.

## Release scope

_[ADR 0001](https://github.com/JGalego/ACT-protocol/blob/main/docs/adr/0001-phase-1-scope-and-deferred-work.md)_

`PROMPT.md` calls for a specification, federated ledger, core packages, HTTP API, SDKs, Explorer visualizations, formal models, Kubernetes deployment, threat-model tests, and examples. ADR 0001 limited the initial release to a tested protocol-to-ledger workflow and deferred the remaining components. Later amendments record additions; the [Roadmap](/roadmap/) lists current gaps.

## RFC 8785 canonicalization

_[ADR 0002](https://github.com/JGalego/ACT-protocol/blob/main/docs/adr/0002-hand-rolled-canonicalization.md)_

Event ids, artifact-version ids, and receipt digests depend on byte-identical RFC 8785 output across implementations. The `canonicalize` package's type declarations did not resolve to its exported function under this repository's `NodeNext` configuration. `packages/core/src/canonical.ts` therefore implements JCS directly: recursively sort object keys by UTF-16 code unit and use `JSON.stringify` for keys and leaf values. Tests include a JCS Unicode-escaping vector.

## Semantic assessment

_[ADR 0005](https://github.com/JGalego/ACT-protocol/blob/main/docs/adr/0005-three-semantic-assessors.md)_

The specification requires structural, provider-neutral AI, and human assessors. Each produces a classification, confidence, rationale, and provenance. The structural assessor returns `exact-preservation` only for byte identity or canonical structural equality; other results are bounded-confidence heuristics. Assessments do not authorize semantic modifications.

## Authentication and trust bootstrap

_[ADR 0006](https://github.com/JGalego/ACT-protocol/blob/main/docs/adr/0006-api-authentication-and-trust-bootstrap.md)_

`POST /v1/keys` requires proof of possession: a valid signature from the key being registered. Authentication identifies the caller; ledger trust determines which actor/key bindings are accepted; authorization determines which actions the actor may perform. These are separate evaluations. [ADR 0009](https://github.com/JGalego/ACT-protocol/blob/main/docs/adr/0009-attribution-key-registry-and-federation-trust.md) adds key fingerprints, owner binding, durable trust, and administrator-gated registration.

## Storage adapters

_[ADR 0004](https://github.com/JGalego/ACT-protocol/blob/main/docs/adr/0004-storage-adapter-interface.md), [ADR 0008](https://github.com/JGalego/ACT-protocol/blob/main/docs/adr/0008-storage-adapter-and-postgres.md)_

ADR 0004 used parameterized SQL and storage-neutral result types while deferring PostgreSQL. ADR 0008 extracted a `StorageAdapter` interface from the existing SQLite calls. Every method returns a `Promise`, allowing the same contract to cover `better-sqlite3` and `pg`. A shared test suite checks both adapters.

## Reading further

The [ADR index](https://github.com/JGalego/ACT-protocol/tree/main/docs/adr) also covers CLI trust bootstrapping (ADR 0007) and schema-generated domain types (ADR 0003).
