# Standards Adoption

This document describes how ACT relates to, and how it can be extended alongside, existing standards and how third parties can propose additions to the protocol itself.

## Relationship to Prior Art

**Non-normative.**

- **[W3C PROV](https://www.w3.org/TR/prov-overview/)** models provenance as Entity/Activity/Agent relationships. ACT's Artifact/Transformation/ Actor model is deliberately close in shape, but ACT adds cryptographic binding (every Transformation and Artifact version is signed), approval/accountability as first-class typed records, and explicit confidence and uncertainty tracking, none of which PROV specifies.
- **[in-toto](https://in-toto.io/)** and **[SLSA](https://slsa.dev/)** address supply-chain attestation for build artifacts specifically. ACT's Event/Attestation model can express the same class of claim (a Verification Report or a signed Transformation record is structurally similar to an in-toto link), but ACT is scoped to the full lifecycle of human/AI collaborative authorship, not only build provenance.
- **[DSSE](https://github.com/secure-systems-lab/dsse)** (Dead Simple Signing Envelope) is used directly as ACT's signed-envelope format (`schemas/envelope/signed-envelope.schema.json`); ACT does not reinvent envelope signing.
- **[Sigstore](https://www.sigstore.dev/)** addresses keyless signing via short-lived certificates bound to an OIDC identity. ACT's key model (`packages/crypto`) is deliberately simpler (long-lived Ed25519 keypairs with an explicit lifecycle) for this release; a Sigstore-style keyless-signing key provider is a plausible future extension via ACT's key-provider interface, not a required one.
- **[Git](https://git-scm.com/)**'s content-addressed object model (commits, trees, blobs addressed by hash) is the closest ancestor of ACT's content-addressed artifact-version identifiers. ACT differs in requiring every version to carry a signature, typed lineage edges (not just parent-commit pointers), and explicit confidence/uncertainty/ policy metadata that Git has no concept of.
- **Event-sourced systems** (e.g. EventStoreDB-style architectures) share ACT's append-only-log-plus-projections structure (`packages/ledger`'s `heads` table is a classic read-model projection). ACT adds cryptographic signing and cross-ledger federation semantics on top of the general event-sourcing pattern.
- **Software Bills of Materials (SBOM)** formats (SPDX, CycloneDX) describe dependency graphs of software artifacts. ACT's Artifact/ Transformation lineage graph could reference or be referenced by an SBOM as one kind of Evidence, but ACT does not define an SBOM format itself.
- **Requirements-traceability systems** and **model cards** overlap with ACT's Requirement artifact type and confidence-assessment model respectively, but neither defines a cryptographic ledger or a federation protocol.
- **Policy engines** (e.g. Open Policy Agent) provide general-purpose rule evaluation. ACT's `packages/policy` is intentionally narrow (approval-requirement and authority-selection evaluation only) rather than a general policy language, so that its evaluation semantics are small enough to be part of the normative spec (`spec/ACT-1.0.md` section 12) rather than an opaque external dependency.

## Proposing an Extension

Two kinds of extension exist:

1. **A new extension namespace** for the `extensions` field on events and artifact records — no protocol version bump required. Open an issue using the "Standards Proposal" template with: the namespace (reverse-DNS style, e.g. `com.example.act-ext.my-field`), the fields it carries, and a fixture demonstrating a read-write round trip that preserves it.
2. **A new algorithm registration** (signature or digest) in `schemas/registry/algorithms.json` — requires conformance vectors (`spec/ACT-1.0.md` section 4.4) before any implementation may produce signatures using it, and does not by itself deprecate the existing required algorithms (Ed25519, SHA-256).

Both go through `GOVERNANCE.md`'s standard PR review; a namespace or algorithm addition is additive and does not require Spec Editor sign-off in the same way a change to `spec/ACT-1.0.md`'s normative text does, though maintainers may request one if the proposal has broader implications.

## Proposing a Normative Protocol Change

Anything that would change the meaning of `spec/`, `schemas/`, or `conformance/` fixtures requires an ADR (`docs/adr/`) and Spec Editor approval per `GOVERNANCE.md`.
