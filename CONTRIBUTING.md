# Contributing to ACT

Thank you for considering a contribution to the ACT Protocol reference
implementation. This document covers day-to-day contribution mechanics; see
`GOVERNANCE.md` for decision-making authority and `docs/adr/` for the
rationale behind existing design choices.

## Prerequisites

- Node.js 22 LTS and pnpm 9+ (`corepack enable`)
- Python 3.12+ (for `sdks/python`)
- A supported stable Go release (for `sdks/go`)
- Stable Rust (for `sdks/rust`)
- Docker and Docker Compose (for `make verify-integration`)

## Getting Started

```bash
git clone <this repository>
cd act-protocol
pnpm install
make verify
```

`make verify` runs every offline quality gate: formatting, linting, strict
type checking, schema fixture validation, and the full first-party test
suite. It must pass before you open a pull request. `make verify-integration`
additionally exercises PostgreSQL and Docker-dependent checks.

## Making Changes

1. **Open an issue first** for anything that changes normative protocol
   behavior (anything in `spec/` or `schemas/`). Protocol changes require an
   Architecture Decision Record (see `docs/adr/0000-adr-process.md`).
2. **Write the test first** where practical, especially for
   canonicalization, cryptographic, ledger, and policy code — these packages
   maintain a 90% branch-coverage floor (`docs/testing-strategy.md`).
3. **No placeholder behavior.** Do not merge disabled tests, TODO-only
   handlers, or APIs that return fabricated data. If something is out of
   scope for now, it must be absent and documented in
   `docs/roadmap.md`, not present and fake.
4. **Schemas are authoritative.** Do not hand-duplicate a type that a JSON
   Schema already defines; regenerate language models instead
   (`scripts/generate-schema-types.ts`).
5. **Conventional commits** are appreciated but not required; a clear,
   imperative-mood summary line is.

## Pull Requests

- Keep PRs scoped to one logical change.
- Include or update tests and documentation in the same PR.
- CI must be green: `make verify`, and `make verify-integration` when your
  change touches PostgreSQL, federation, Docker, or Explorer code.
- Fill in the PR template's conformance-impact checklist if you touched
  `spec/`, `schemas/`, or `conformance/`.

## Code of Conduct

Participation in this project is governed by the expectation of respectful,
harassment-free collaboration. Report concerns to the maintainers listed in
`GOVERNANCE.md`.

## Reporting Security Issues

Do not file public issues for vulnerabilities — see `SECURITY.md`.
