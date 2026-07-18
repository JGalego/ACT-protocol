---
title: Getting Started
description: Install ACT Protocol's reference implementation and run the animated demonstration, API, and CLI locally.
---

## Prerequisites

- **Node.js 22 LTS**
- **pnpm 9+** (`corepack enable`)

## Install

```bash
git clone https://github.com/JGalego/ACT-protocol.git
cd act-protocol
pnpm install

# Regenerate the artifact-type schemas and their TypeScript types
# (already committed, but this is how you'd regenerate them):
pnpm run generate:artifact-types
pnpm run generate:types

# Run every offline quality gate: formatting, linting, strict type
# checking, schema fixture validation, and the full test suite.
make verify
```

:::tip[Working on just one package] Every package under `packages/`, `services/`, and `apps/` builds and tests independently — `pnpm --filter @act/ledger run test` (for example) is much faster than `make verify` while you're iterating on one piece. :::

## Run the animated protocol demonstration

```bash
pnpm run dev:explorer
# -> ACT Explorer at http://localhost:4173
```

The seeded walkthrough animates a complete accountable chain: human intent → AI proposal → requirements transformation → scoped approval → implementation → tests → semantic drift finding → human challenge → revision → runtime observation. Use play/pause, step controls, arrow keys, or the timeline scrubber; select records to inspect rationale, assumptions, uncertainty, evidence, lineage, confidence, and envelope content. The **Data source** control can also load ordered signed envelopes from a running ACT `/v1/events` endpoint. Seeded identities and digests are visibly marked as non-production demonstration data.

:::tip[Five more scenarios beyond the Explorer] `pnpm --filter @act/examples run test` runs five additional seeded, assertion-backed walkthroughs — enterprise quorum approval, competing AI proposals, cross-ledger federation, and more. See [Examples](/examples/). :::

## Start the reference API service

SQLite-backed, local development mode:

```bash
ACT_DEV_MODE=true pnpm --filter @act/api run dev
# -> Fastify listening on :4000; see services/api/openapi/act-v1.yaml
```

## Use the `act` CLI

Against a local embedded workspace:

```bash
cd /somewhere/else
node <path-to-repo>/apps/cli/dist/bin/act.js init --json
node <path-to-repo>/apps/cli/dist/bin/act.js intent create "Ship the thing" --json
node <path-to-repo>/apps/cli/dist/bin/act.js verify --json
```

(Once published, this will just be `npm install -g @act/cli && act init`.)

## Building against ACT from your own code

Use [`@act/sdk`](/sdks/) (TypeScript) or [`act-sdk`](/sdks/) (Python) rather than hand-building signed envelopes — both handle canonicalization, digesting, and Ed25519 signing for you, and are checked against the same conformance vectors so events built with either are indistinguishable to the API.

## Next steps

- Read the [Architecture](/architecture/) page to see how a transformation actually flows through the protocol.
- Read the [Specification](/specification/) page for the normative node classes, semantic-change taxonomy, and intent authority model.
- See the [API Reference](/api-reference/) for every `/v1` operation the reference service implements.
- Browse [Examples](/examples/) for six more seeded end-to-end scenarios, or [Deployment](/deployment/) to run the full stack via Docker Compose or Helm.
- Read [Design Decisions](/design-decisions/) for the history behind ACT's less-obvious implementation choices.
