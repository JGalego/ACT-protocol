# Example: Enterprise OIDC Identities, Quorum Approval, and Audit Export

An enterprise workflow with OIDC identities, quorum approval, restricted evidence, and audit export (PROMPT.md's Example Applications item #4).

**Scenario** (`scenario.test.ts`): `services/api` is built with real production OIDC configuration (`devMode: false`, `oidc: {issuer, audience}`) against `services/api/src/oidc/dev-provider.ts` -- the same deterministic local OIDC emulator ADR 0006's amendment added -- so every actor authenticates with a real, verified JWT, not the local dev bearer scheme every other example uses. An engineer implements a customer-data-export feature; a security reviewer attaches confidential evidence; a policy requires 2-of-N reviewer approval with separation of duties; two of three available reviewers approve; the third never votes.

Run it:

```bash
pnpm --filter @act/examples exec vitest run enterprise-oidc-quorum
```

## What it proves

- Every request in this example carries a real bearer JWT, verified end-to-end by `services/api`'s production auth path (signature, issuer, audience, expiry against the dev provider's JWKS) -- not the `ACT_DEV_MODE` bearer-as-actor-id scheme.
- The Evidence artifact is recorded with `content.sensitivity: "confidential"`.
- Quorum is evaluated for real via `@act/policy`'s `evaluateApprovalRequirement`/`evaluateQuorum` -- not just "two `approval_decided` events exist". The test explicitly proves quorum=1 would **not** satisfy this policy, and that the transformation author's own hypothetical approval would **not** count toward quorum (separation of duties), by re-running the same evaluation function against different approval sets.
- `POST /v1/bundles/export` (the audit export) contains every event recorded: the intent, the evidence, the transformation, and both approval decisions.

## Equivalent CLI usage

`docs/deployment.md` documents running `services/api` in this same production OIDC configuration via Docker Compose (`deploy/compose/docker-compose.yml`'s `oidc-provider` service); this example proves the same configuration works by building the server in-process instead.
