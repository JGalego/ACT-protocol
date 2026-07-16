# Security Policy

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, email the address published in the repository's `GOVERNANCE.md` maintainers list with:

- a description of the vulnerability and its impact
- steps to reproduce, or a proof of concept
- the affected package(s) and version(s)
- your assessment of severity, if you have one

You will receive an acknowledgement within 5 business days. We aim to ship a fix or mitigation within 90 days of a confirmed report, coordinated with you on disclosure timing.

## Scope

This policy covers:

- `packages/*`, `services/*`, `apps/*` in this repository
- `sdks/*` (Python, Go, Rust)
- the published container images and Helm chart under `deploy/`

Out of scope: vulnerabilities that require an attacker to already possess a valid, non-revoked private key that a trust policy has explicitly designated as trusted, and denial-of-service reports that rely purely on running an unbounded number of legitimate, authenticated requests without exploiting a missing limit.

## Supported Versions

During the 1.0 release-candidate line, security fixes are backported only to the latest `1.0.0-rc.x` tag. Once 1.0.0 is tagged, this section will be updated with a support matrix per `docs/versioning.md`.

## Threat Model

See [docs/threat-model.md](docs/threat-model.md) for the structured threat model (assets, actors, attacker capabilities, trust boundaries, abuse cases, mitigations, detection, and residual risk) that this project maintains and tests against.

## Security Design Baseline

ACT's security defaults are documented in [docs/security-and-privacy-guide.md](docs/security-and-privacy-guide.md). Highlights enforced in this repository:

- No plaintext secrets, credentials, private keys, or tokens in logs, fixtures, exported diagnostics, or committed configuration — enforced by the secret-scan quality gate in `make verify`.
- Cryptographic signature validity, event/content digest validity, key status, identity binding, trust-policy acceptance, and authorization-policy acceptance are reported as independent results, never collapsed into a single boolean.
- Production mode fails closed when required secrets, trusted issuers, encryption keys, or secure configuration are missing.
- Dependency, container, and static-analysis scanning run in CI; the release candidate ships with no known critical or high severity vulnerabilities in runtime dependencies or container images (see `docs/dependency-audit.md` for the current SBOM and scan output).
