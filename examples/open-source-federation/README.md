# Example: Open-Source Federation with an External Contribution

An open-source collaboration with external contributions and signed bundle federation (PROMPT.md's Example Applications item #5).

**Scenario** (`scenario.test.ts`): an external contributor works entirely on their own independently-hosted ledger (a separate `services/api` instance, never sharing a database with upstream); the maintainer's upstream instance registers the fork as a federation peer and pulls it (`POST /v1/federation/pull`), then reviews and merges (approves) the contribution through the normal policy/approval flow.

Run it:

```bash
pnpm --filter @act/examples exec vitest run open-source-federation
```

## Checks

- The contributor's signed Key event introduces their key through the verified bundle from the pinned peer. Upstream then accepts another event from that contributor without a separate key-registration request.
- The clean contribution returns empty `findings.forks` and `findings.equivocations` arrays.
- Upstream's own `GET /v1/artifacts/:id/versions` for the contributed artifact includes the contributor's original signed event byte-for-byte, not a re-signed or re-attributed copy.

## Equivalent CLI usage

`act export`/`act import` (or `POST /v1/bundles/export`/`import` directly) move a bundle as a file rather than over a live peer connection -- useful for a contributor who wants to hand over a signed bundle out-of-band (e.g. attached to a pull request) instead of exposing their ledger's HTTP endpoint to the maintainer.
