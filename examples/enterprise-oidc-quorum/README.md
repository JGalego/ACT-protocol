# Example: Enterprise OIDC Identities, Quorum Approval, and Audit Export

An enterprise workflow with OIDC identities, quorum approval, restricted evidence, and audit export (PROMPT.md's Example Applications item #4).

**Scenario** (`scenario.test.ts`): the API uses `devMode: false` and `oidc: {issuer, audience}` with the local OIDC provider. Actors authenticate with JWTs. An engineer implements customer-data export, a reviewer attaches confidential evidence, and two of three reviewers approve under a quorum-2 policy with separation of duties.

Run it:

```bash
pnpm --filter @act/examples exec vitest run enterprise-oidc-quorum
```

## Checks

- Requests carry JWTs checked by the production verifier for signature, issuer, audience, and expiry against the local provider's JWKS.
- The Evidence artifact is recorded with `content.sensitivity: "confidential"`.
- `evaluateApprovalRequirement`/`evaluateQuorum` accept two reviewers, reject a single reviewer, and exclude the transformation author's approval.
- `POST /v1/bundles/export` (the audit export) contains every event recorded: the intent, the evidence, the transformation, and both approval decisions.

## Equivalent CLI usage

The Compose stack also includes the local OIDC provider; see `docs/deployment.md`.
