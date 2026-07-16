# Release Checklist

This is the operational checklist `GOVERNANCE.md`'s release process
refers to. It mirrors `PROMPT.md`'s Definition of Done, scoped to what
this repository actually claims to implement (see
`docs/adr/0001-phase-1-scope-and-deferred-work.md` and
`docs/roadmap.md` for what is explicitly out of scope).

## Before Tagging a Release

- [ ] `make verify` passes from a clean checkout (`git clean -fdx` in a
      scratch clone, then `pnpm install && make verify`)
- [ ] `make verify-integration` passes, or its unmet prerequisite
      (Docker/PostgreSQL) is explicitly documented in the release notes
      rather than silently skipped
- [ ] Every package's coverage meets its floor (90% for
      core/crypto/ledger/policy/verification, 80% for the rest;
      `docs/testing-strategy.md`)
- [ ] `pnpm run schemas:validate` passes (every schema fixture, positive
      and negative)
- [ ] `services/api`'s OpenAPI document
      (`services/api/openapi/act-v1.yaml`) matches the routes actually
      registered in `services/api/src/server.ts`
- [ ] `CHANGELOG.md` has a dated entry for the release, listing what
      shipped and linking to `docs/roadmap.md` for what didn't
- [ ] No plaintext secret, credential, private key, or token appears in
      any committed file (`git grep` for common patterns; `apps/cli`'s
      own generated `.act/` workspace directories are gitignored)
- [ ] Every internal doc cross-reference (`docs/*.md`, ADRs, `README.md`)
      resolves to a real file
- [ ] Version bumped consistently across every `package.json` in the
      workspace, following `docs/versioning.md`'s implementation-version
      axis (protocol/schema/API versions only change when their own
      compatibility rules require it, not on every release)

## Cutting the Release

1. Update `CHANGELOG.md` and every workspace `package.json` version.
2. `git tag -a vX.Y.Z -m "..."` on `main` once the checklist above is
   green.
3. Publish workspace packages (`packages/*`, `services/api`, `apps/cli`)
   to their respective registries once publishing is configured (not yet
   set up in this release — packages currently install via
   `workspace:*` only).

## After a Release

- Confirm the tag's CI run is green (not just the local `make verify`).
- File roadmap-tracking issues for anything newly discovered to be
  missing, rather than silently deferring it a second time.
