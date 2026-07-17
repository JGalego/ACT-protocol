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

## Run the animated protocol demonstration

```bash
pnpm run dev:explorer
# -> ACT Explorer at http://localhost:4173
```

The seeded walkthrough animates a complete accountable chain: human intent → AI proposal → requirements transformation → scoped approval → implementation → tests → semantic drift finding → human challenge → revision → runtime observation. Use play/pause, step controls, arrow keys, or the timeline scrubber; select records to inspect rationale, assumptions, uncertainty, evidence, lineage, confidence, and envelope content. The **Data source** control can also load ordered signed envelopes from a running ACT `/v1/events` endpoint. Seeded identities and digests are visibly marked as non-production demonstration data.

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

## Next steps

- Read the [Architecture](/architecture/) page to see how a transformation actually flows through the protocol.
- Read the [Specification](/specification/) page for the normative node classes, semantic-change taxonomy, and intent authority model.
- See the [API Reference](/api-reference/) for every `/v1` operation the reference service implements.
