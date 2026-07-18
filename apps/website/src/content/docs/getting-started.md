---
title: Getting Started
description: Install ACT Protocol's reference implementation and run the animated demonstration, API, and CLI locally.
---

## Prerequisites

- **Node.js 22 LTS**
- **pnpm 9+** (`corepack enable`)

## Install

Clone the repository and install dependencies.

```bash
git clone https://github.com/JGalego/ACT-protocol.git
cd act-protocol
pnpm install
```

The artifact-type schemas and their TypeScript types are already generated and committed. You only need this if you change a schema and want to regenerate them yourself.

```bash
pnpm run generate:artifact-types
pnpm run generate:types
```

Then run every offline quality gate at once: formatting, linting, strict type checking, schema fixture validation, and the full test suite.

```bash
make verify
```

Working on a single package instead? Every package under `packages/`, `services/`, and `apps/` builds and tests independently, so `pnpm --filter @act/ledger run test` finishes in a fraction of the time `make verify` takes.

## Run the animated protocol demonstration

```bash
pnpm run dev:explorer
# -> ACT Explorer at http://localhost:4173
```

The seeded walkthrough animates a complete accountable chain: human intent, an AI proposal, a requirements transformation, a scoped approval, implementation, tests, a semantic drift finding, a human challenge, a revision, and a runtime observation. Use play/pause, step controls, arrow keys, or the timeline scrubber. Select any record to inspect its rationale, assumptions, uncertainty, evidence, lineage, confidence, and envelope content. The **Data source** control can also load ordered signed envelopes from a running ACT `/v1/events` endpoint. Seeded identities and digests are visibly marked as non-production demonstration data.

:::tip[Five more scenarios beyond the Explorer]

`pnpm --filter @act/examples run test` runs five more seeded, assertion-backed walkthroughs alongside this one, including enterprise quorum approval, competing AI proposals, and cross-ledger federation. See [Examples](/examples/) for what each one proves.

:::

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

Once published, this will just be `npm install -g @act/cli && act init`.

## Building against ACT from your own code

Reach for [`@act/sdk`](/sdks/) in TypeScript or [`act-sdk`](/sdks/) in Python rather than hand-building signed envelopes yourself. Both handle canonicalization, digesting, and Ed25519 signing, and both are checked against the same conformance vectors, so an event built with one is indistinguishable from an event built with the other by the time it reaches the API.

## Next steps

- [Architecture](/architecture/) walks through how a transformation actually flows through the protocol.
- [Specification](/specification/) covers the normative node classes, semantic-change taxonomy, and intent authority model.
- [API Reference](/api-reference/) lists every `/v1` operation the reference service implements.
- [Examples](/examples/) has six more seeded end-to-end scenarios. [Deployment](/deployment/) runs the full stack via Docker Compose or Helm.
- [Design Decisions](/design-decisions/) covers the history behind ACT's less obvious implementation choices.
