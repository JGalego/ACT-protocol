---
title: Design Decisions
description: Why ACT's reference implementation is built the way it is — the history behind the non-obvious choices.
---

ACT's reference implementation records its own non-obvious decisions the same way it asks protocol users to: as attributed, dated claims with rationale, not silent diffs. Every one lives as a full Architecture Decision Record under [`docs/adr/`](https://github.com/JGalego/ACT-protocol/tree/main/docs/adr) on GitHub; this page is a narrative map of the ones most worth understanding before you read the code.

## Why this is a vertical slice, not a shallow pass over everything

_[ADR 0001](https://github.com/JGalego/ACT-protocol/blob/main/docs/adr/0001-phase-1-scope-and-deferred-work.md)_

The full protocol specification describes a normative spec, a federated ledger, five core packages, an HTTP API, SDKs in four languages with cross-language conformance, a production Explorer with nine visualizations, machine-checked formal models, production Kubernetes deployment, a full threat-model test suite, and six seeded example applications — genuinely a multi-month, multi-team effort. Building all of it to the letter in one sitting, while honoring the spec's own explicit ban on placeholder handlers, disabled tests, and APIs that return fabricated data, isn't achievable without violating that ban somewhere.

So the reference implementation is a complete, non-fabricated vertical slice instead: everything it claims to do, it actually does, with real tests proving it — rather than every feature existing in a stubbed, unconvincing form. The [Roadmap](/roadmap/) is the running list of what's deliberately outside that slice, and why.

## Why RFC 8785 canonicalization is hand-rolled instead of a dependency

_[ADR 0002](https://github.com/JGalego/ACT-protocol/blob/main/docs/adr/0002-hand-rolled-canonicalization.md)_

Every content-addressed identifier in ACT — event ids, artifact-version ids, receipt digests — depends on RFC 8785 (the JSON Canonicalization Scheme) producing byte-identical output across implementations. The obvious path was the `canonicalize` npm package, but under this repository's `NodeNext` module resolution its CommonJS-shaped type definitions bound incorrectly at the type level. Rather than fight the interop, `packages/core/src/canonical.ts` implements RFC 8785 directly: for ACT's restricted JSON data model, it reduces to two rules (sort object keys by UTF-16 code unit; reuse `JSON.stringify` for every leaf, which already implements JCS-compatible number formatting). Under 40 lines, covered by a known JCS Unicode-escaping test vector.

## Why three independent semantic assessors, none authoritative alone

_[ADR 0005](https://github.com/JGalego/ACT-protocol/blob/main/docs/adr/0005-three-semantic-assessors.md)_

The spec requires deterministic structural, provider-neutral AI, and human semantic assessment — and explicitly forbids any automated assessor from silently approving a semantic modification. `packages/verification/src/semantic/` runs all three side by side, producing the same attributed shape (classification, confidence, rationale, provenance). The structural assessor only ever claims `exact-preservation` for genuinely mechanical cases (byte identity, canonical structural equality); everything else is an explicitly bounded-confidence heuristic that says so in its own rationale, rather than a hidden fudge factor.

## Why authentication, trust, and authority are three separate evaluations

_[ADR 0006](https://github.com/JGalego/ACT-protocol/blob/main/docs/adr/0006-api-authentication-and-trust-bootstrap.md)_

A genuinely new actor has, by definition, no pre-existing trusted key on the ledger it's joining — some bootstrap mechanism is required. The tempting shortcut, "the server trusts whatever key shows up first," would violate the protocol's Core Principle 7 (No Hidden Global Authority). Instead, `POST /v1/keys` requires proof of possession — the caller must produce a valid signature from the key they're registering — and being authenticated never by itself grants ledger authority. Authentication (who's calling), trust (is this key vouched for), and authorization (is this actor allowed to do this) stay three separate, independently inspectable evaluations, exactly as `spec/ACT-1.0.md` §11 requires.

## Why the storage adapter was split into two ADRs

_[ADR 0004](https://github.com/JGalego/ACT-protocol/blob/main/docs/adr/0004-storage-adapter-interface.md), [ADR 0008](https://github.com/JGalego/ACT-protocol/blob/main/docs/adr/0008-storage-adapter-and-postgres.md)_

ADR 0004 shaped `packages/ledger`'s `Ledger` class — parameterized SQL through prepared statements, no SQLite-specific dialect sugar — so that a PostgreSQL adapter could be added later without an API break, but deliberately didn't build it yet (that would have exceeded ADR 0001's honest slice). ADR 0008 is that later step: a `StorageAdapter` interface extracted 1:1 from `Ledger`'s previous direct `better-sqlite3` calls, with every method returning a `Promise` so one contract covers both a synchronous driver and PostgreSQL's inherently asynchronous `pg` client. The same test suite now runs twice — once per adapter — proving behavioral equivalence rather than asserting it.

:::note[The pattern underneath all of these] Every one of these decisions picks the option that stays honestly, verifiably true today over the option that looks more complete on paper. That's also what ACT the protocol asks of every transformation it records — an attributed, falsifiable claim beats a confident-sounding one. :::

## Reading further

The full [ADR index](https://github.com/JGalego/ACT-protocol/tree/main/docs/adr) covers CLI trust bootstrapping (ADR 0007) and schema-generated domain types (ADR 0003) as well — each follows the same shape: context, decision, and the trade-off it accepts.
