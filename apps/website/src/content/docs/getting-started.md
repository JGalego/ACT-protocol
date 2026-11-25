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

The generated artifact schemas and TypeScript types are committed. Regenerate them after changing their sources:

```bash
pnpm run generate:artifact-types
pnpm run generate:types
```

Run the offline checks: formatting, linting, type checking, schema fixtures, and tests.

```bash
make verify
```

Packages build and test independently. For a targeted test run, use a filter such as `pnpm --filter @act/ledger run test`.

## Run the animated protocol demonstration

```bash
pnpm run dev:explorer
# -> ACT Explorer at http://localhost:4173
```

The walkthrough follows human intent through an AI proposal, requirements, approval, implementation, tests, a drift finding, a challenge, a revision, and a runtime observation. Use playback, step controls, arrow keys, or the timeline scrubber; select a record to inspect its rationale, assumptions, uncertainty, evidence, lineage, confidence, and envelope. The **Data source** control loads ordered signed envelopes from an ACT `/v1/events` endpoint. Seeded identities and digests are marked as non-production demonstration data.

:::tip[API examples]

`pnpm --filter @act/examples run test` runs API scenarios covering enterprise quorum approval, competing AI proposals, and cross-ledger federation. See [Examples](/examples/).

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

After publication: `npm install -g @act/cli && act init`.

## Building against ACT from your own code

Use [`@act/sdk`](/sdks/) in TypeScript or [`act-sdk`](/sdks/) in Python to canonicalize, digest, sign, and submit events. Both are checked against shared conformance vectors.

## Next steps

- [Architecture](/architecture/) describes the event write path.
- [Specification](/specification/) covers the normative node classes, semantic-change taxonomy, and intent authority model.
- [API Reference](/api-reference/) lists every `/v1` operation the reference service implements.
- [Examples](/examples/) covers the API scenarios and Explorer walkthrough. [Deployment](/deployment/) describes Docker Compose and Helm.
- [Design Decisions](/design-decisions/) covers the history behind ACT's less obvious implementation choices.
