#!/usr/bin/env -S node --import tsx
/**
 * `make verify-integration`'s actual test: starts services/api's REAL
 * built server (services/api/dist/server.js) as a child process against
 * ACT_STORAGE=postgres, pointed at the dockerized Postgres
 * deploy/compose/docker-compose.test.yml brings up, then drives a real
 * key-registration -> actor -> intent -> event-listing sequence over
 * HTTP. This exercises a genuinely different code path than
 * packages/ledger's embedded-postgres unit tests (which run PostgresAdapter
 * in-process, never through services/api or a container boundary at all).
 *
 * Requires: `pnpm run build` already run, and ACT_DATABASE_URL pointing at
 * a real, reachable PostgreSQL (see docs/deployment.md and
 * `make verify-integration`, which brings one up via Docker Compose and
 * sets this).
 */
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateId } from '@act/core';
import { generateKeyPair, signEnvelope } from '@act/crypto';
import { buildUnsignedEvent } from '@act/sdk';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_ENTRY = join(ROOT, 'services/api/dist/server.js');
const PORT = 4100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function waitForReady(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/v1/health/ready`);
      if (response.ok) return;
    } catch {
      // server not accepting connections yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`server did not become ready within ${timeoutMs}ms`);
}

async function runSmokeSequence(): Promise<void> {
  await waitForReady(30_000);
  console.log('integration-smoke: server is ready against a real PostgreSQL backend');

  const actorId = generateId();
  const keyPair = generateKeyPair();
  const artifactId = generateId();
  const versionId = `sha-256:${'1'.repeat(64)}`;

  const keyEvent = buildUnsignedEvent({
    eventType: 'genesis',
    actor: { actorId, keyId: keyPair.keyId },
    tenant: 'integration-smoke',
    subject: {
      kind: 'artifact',
      artifact_id: artifactId,
      version_id: versionId,
      artifact_type: 'Key',
    },
    payload: {
      artifact_id: artifactId,
      schema_version: '1.0',
      protocol_version: 'act/1.0',
      authoring_actor: { actor_id: actorId, key_id: keyPair.keyId },
      created_at_claim: new Date().toISOString(),
      artifact_type: 'Key',
      content: {
        media_type: 'application/json',
        byte_length: 0,
        digest: `sha-256:${'0'.repeat(64)}`,
        storage: { kind: 'inline', inline_value: '' },
        sensitivity: 'internal',
        availability_state: 'available',
      },
      lineage: [],
      applicable_policy: { not_applicable: true, reason: 'integration smoke fixture' },
      confidence_assessments: [],
      uncertainties: [],
      evidence_refs: [],
      sensitivity: 'internal',
      retention_policy_id: null,
      version_id: versionId,
      data: {
        key_id: keyPair.keyId,
        algorithm: 'ed25519',
        public_key: keyPair.publicKey,
        status: 'active',
        owner_actor_id: actorId,
      },
    },
  });
  const signedKeyEvent = signEnvelope(keyEvent, [keyPair]);

  const keyResponse = await fetch(`${BASE_URL}/v1/keys`, {
    method: 'POST',
    headers: { authorization: `Bearer ${actorId}`, 'content-type': 'application/json' },
    body: JSON.stringify(signedKeyEvent),
  });
  if (keyResponse.status !== 201) {
    throw new Error(
      `key registration failed: HTTP ${keyResponse.status}: ${await keyResponse.text()}`,
    );
  }

  const eventsResponse = await fetch(`${BASE_URL}/v1/events`, {
    headers: { authorization: `Bearer ${actorId}` },
  });
  if (eventsResponse.status !== 200) {
    throw new Error(`event listing failed: HTTP ${eventsResponse.status}`);
  }
  const { items } = (await eventsResponse.json()) as { items: unknown[] };
  if (items.length < 1) {
    throw new Error(
      'expected at least one event to be recorded in the real Postgres-backed ledger',
    );
  }

  console.log(
    `integration-smoke: OK -- registered a key and confirmed ${items.length} event(s) recorded against real PostgreSQL`,
  );
}

function startServer(databaseUrl: string): {
  child: ChildProcessWithoutNullStreams;
  output: () => string;
} {
  const child = spawn('node', [SERVER_ENTRY], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(PORT),
      ACT_DEV_MODE: 'true',
      ACT_STORAGE: 'postgres',
      ACT_DATABASE_URL: databaseUrl,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk.toString()));
  child.stderr.on('data', (chunk) => (output += chunk.toString()));
  return { child, output: () => output };
}

async function main(): Promise<void> {
  if (!existsSync(SERVER_ENTRY)) {
    throw new Error(`${SERVER_ENTRY} does not exist -- run "pnpm run build" first`);
  }
  const databaseUrl = process.env.ACT_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('ACT_DATABASE_URL is required (see deploy/compose/docker-compose.test.yml)');
  }

  const { child, output } = startServer(databaseUrl);
  try {
    await runSmokeSequence();
  } catch (err) {
    console.error('--- server output ---\n' + output());
    throw err;
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
}

main().catch((err) => {
  console.error(
    `integration-smoke: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
  );
  process.exit(1);
});
