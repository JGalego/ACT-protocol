# Governance

## Project Structure

ACT is developed as an open, implementation-independent protocol (`spec/`, `schemas/`, `formal/`, `conformance/`) alongside a reference implementation (everything else in this repository). Governance applies to both, but the bar for changing the protocol is higher than the bar for changing the reference implementation.

## Roles

- **Maintainers** — have merge authority, run releases, and are the contact point for security reports. The current maintainer list is kept in `.github/MAINTAINERS.md` (or, until that file exists, in the repository metadata of the hosting organization).
- **Contributors** — anyone who opens an issue, discussion, or pull request.
- **Spec Editors** — maintainers designated to accept changes under `spec/` and `schemas/`. Every normative change requires sign-off from at least one Spec Editor in addition to normal PR review.

## Decision Process

1. **Reference-implementation changes** (packages, services, apps, SDKs, docs, examples, deploy manifests): standard PR review, at least one maintainer approval, CI green.
2. **Normative protocol changes** (anything that would change the meaning of `spec/`, `schemas/`, or `conformance/` fixtures): requires an Architecture Decision Record under `docs/adr/`, Spec Editor approval, and a corresponding conformance fixture update. Breaking changes require a protocol version bump per `docs/versioning.md`.
3. **Disputes** that cannot be resolved in review are escalated to a maintainer vote; a simple majority of maintainers decides, with the rationale recorded as an ADR.

No single maintainer, ledger operator, identity provider, or organization holds unilateral authority over the protocol's trust roots, policy authorities, or conflict-resolution rules — per Core Principle 7 in `spec/ACT-1.0.md`, "No Hidden Global Authority" applies to project governance as much as to protocol design.

## Release Process

Releases follow semantic versioning across four independent axes — protocol, schema, API, and implementation version (`docs/versioning.md`). A release is cut only when `make verify` and `make verify-integration` pass and the Definition of Done in `PROMPT.md` / `docs/release-checklist.md` is satisfied for the scope claimed by that release.

## Standards Adoption and Extension Process

External parties wishing to register a schema extension namespace, a new cryptographic algorithm, or a new artifact type should open an issue using the "Standards Proposal" template, which requires: motivation, a draft schema or algorithm identifier, backward-compatibility analysis, and a reference implementation or fixture demonstrating the proposal. See `docs/standards-adoption.md` for the full process.

## Changing This Document

Changes to `GOVERNANCE.md` itself require maintainer majority approval and are recorded as an ADR.
