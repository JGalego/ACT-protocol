import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalize, digestBytes, generateId } from '@act/core';
import { generateKeyPair, signBytes, signEnvelope } from '@act/crypto';
import { buildUnsignedEvent } from '@act/sdk';
import {
  actionBackup,
  actionDoctor,
  actionExport,
  actionHistory,
  actionImport,
  actionInit,
  actionIntentCreate,
  actionKeyList,
  actionKeyTrust,
  actionLineage,
  actionProjectionRebuild,
  actionRestore,
  actionVerify,
  actionWhoami,
} from '../actions.js';
import { WorkspaceNotFoundError } from '../workspace.js';

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(path.join(os.tmpdir(), 'act-cli-test-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe('actionInit', () => {
  it('creates a workspace with a fresh identity', () => {
    const result = actionInit(cwd);
    expect(result.ok).toBe(true);
    const data = result.data as { actorId: string; keyId: string; ledgerId: string };
    expect(data.actorId).toBeTruthy();
    expect(data.keyId).toMatch(/^ed25519:/);
  });

  it('refuses to re-initialize an existing workspace', () => {
    actionInit(cwd);
    expect(() => actionInit(cwd)).toThrow(/already exists/);
  });
});

describe('actionDoctor', () => {
  it('reports a missing workspace as a failing check', async () => {
    const result = await actionDoctor(cwd);
    expect(result.ok).toBe(false);
    const checks = (result.data as { checks: { name: string; ok: boolean }[] }).checks;
    expect(checks.find((c) => c.name === 'workspace-config')?.ok).toBe(false);
  });

  it('reports a healthy workspace as all-passing', async () => {
    actionInit(cwd);
    const result = await actionDoctor(cwd);
    expect(result.ok).toBe(true);
  });

  it('reports an unreadable ledger as a failing check', async () => {
    actionInit(cwd);
    // Replace the ledger file with a directory so opening it as a SQLite
    // database throws (EISDIR), exercising the doctor's failure path.
    rmSync(path.join(cwd, '.act', 'ledger.db'), { force: true });
    mkdirSync(path.join(cwd, '.act', 'ledger.db'));
    const result = await actionDoctor(cwd);
    expect(result.ok).toBe(false);
    const checks = (result.data as { checks: { name: string; ok: boolean }[] }).checks;
    expect(checks.find((c) => c.name === 'ledger-readable')?.ok).toBe(false);
  });
});

describe('actionWhoami', () => {
  it('throws WorkspaceNotFoundError without a workspace', () => {
    expect(() => actionWhoami(cwd)).toThrow(WorkspaceNotFoundError);
  });

  it('returns the local actor config after init', () => {
    actionInit(cwd);
    const result = actionWhoami(cwd);
    expect((result.data as { actorId: string }).actorId).toBeTruthy();
  });
});

describe('actionKeyList / actionKeyTrust', () => {
  it('lists the workspace key by default', () => {
    const init = actionInit(cwd);
    const result = actionKeyList(cwd);
    const keys = result.data as Record<string, string>;
    expect(Object.keys(keys)).toContain((init.data as { keyId: string }).keyId);
  });

  it('adds a trusted key', () => {
    actionInit(cwd);
    actionKeyTrust(cwd, 'ed25519:' + 'a'.repeat(64), 'fakepublickey');
    const keys = actionKeyList(cwd).data as Record<string, string>;
    expect(keys['ed25519:' + 'a'.repeat(64)]).toBe('fakepublickey');
  });
});

describe('actionIntentCreate', () => {
  it('creates a genesis Intent event', async () => {
    actionInit(cwd);
    const result = await actionIntentCreate(cwd, 'Ship the CLI', 'test-scope');
    expect(result.ok).toBe(true);
    const data = result.data as { eventId: string; sequence: number };
    expect(data.sequence).toBe(0);
    expect(data.eventId).toMatch(/^sha-256:/);
  });
});

describe('actionVerify', () => {
  it('reports no findings for a healthy freshly-created ledger', async () => {
    actionInit(cwd);
    await actionIntentCreate(cwd, 'Intent A', 'test');
    const result = await actionVerify(cwd);
    expect(result.ok).toBe(true);
    expect((result.data as { findings: unknown[] }).findings).toEqual([]);
  });
});

describe('actionLineage / actionHistory', () => {
  it('returns lineage for a known event and an error for an unknown one', async () => {
    actionInit(cwd);
    const created = await actionIntentCreate(cwd, 'Intent A', 'test');
    const eventId = (created.data as { eventId: string }).eventId;

    const found = await actionLineage(cwd, eventId);
    expect(found.ok).toBe(true);

    const notFound = await actionLineage(cwd, `sha-256:${'0'.repeat(64)}`);
    expect(notFound.ok).toBe(false);
  });

  it('returns the version history for an artifact', async () => {
    actionInit(cwd);
    const created = await actionIntentCreate(cwd, 'Intent A', 'test');
    const artifactId = (created.data as { artifactId: string }).artifactId;
    const history = await actionHistory(cwd, artifactId);
    expect((history.data as { items: unknown[] }).items).toHaveLength(1);
  });
});

describe('actionExport / actionImport', () => {
  it('exports a bundle and imports it into a fresh workspace that trusts the source key', async () => {
    const init = actionInit(cwd);
    const { keyId, publicKey } = init.data as { keyId: string; publicKey: string };
    await actionIntentCreate(cwd, 'Federated intent', 'test');
    const bundleFile = path.join(cwd, 'bundle.json');
    const exportResult = await actionExport(cwd, bundleFile);
    expect(exportResult.ok).toBe(true);
    expect((exportResult.data as { eventCount: number }).eventCount).toBe(1);

    const secondCwd = mkdtempSync(path.join(os.tmpdir(), 'act-cli-test-2-'));
    try {
      actionInit(secondCwd);
      // A fresh workspace only trusts its own key by default; importing
      // events from another workspace requires explicitly trusting its
      // key first (act key trust), mirroring real cross-workspace federation.
      actionKeyTrust(secondCwd, keyId, publicKey);
      const importResult = await actionImport(secondCwd, bundleFile);
      expect(importResult.ok).toBe(true);
      expect((importResult.data as { accepted: number }).accepted).toBe(1);
    } finally {
      rmSync(secondCwd, { recursive: true, force: true });
    }
  });

  it('quarantines an imported event whose signing key is not trusted', async () => {
    actionInit(cwd);
    await actionIntentCreate(cwd, 'Untrusted-origin intent', 'test');
    const bundleFile = path.join(cwd, 'bundle.json');
    await actionExport(cwd, bundleFile);

    const secondCwd = mkdtempSync(path.join(os.tmpdir(), 'act-cli-test-3-'));
    try {
      actionInit(secondCwd);
      const importResult = await actionImport(secondCwd, bundleFile);
      expect(importResult.ok).toBe(true);
      expect((importResult.data as { accepted: number; quarantined: string[] }).accepted).toBe(0);
      expect((importResult.data as { quarantined: string[] }).quarantined.length).toBe(1);
    } finally {
      rmSync(secondCwd, { recursive: true, force: true });
    }
  });

  it('reports an error for a missing import file', async () => {
    actionInit(cwd);
    const result = await actionImport(cwd, path.join(cwd, 'does-not-exist.json'));
    expect(result.ok).toBe(false);
  });

  it('reports an error for a bundle that fails its own schema validation', async () => {
    actionInit(cwd);
    const badFile = path.join(cwd, 'bad-bundle.json');
    writeFileSync(badFile, JSON.stringify({ not: 'a bundle' }));
    const result = await actionImport(cwd, badFile);
    expect(result.ok).toBe(false);
    expect((result.data as { error: string }).error).toMatch(/schema validation/);
  });

  it('restricts export to specific artifact ids', async () => {
    actionInit(cwd);
    const a = await actionIntentCreate(cwd, 'Intent A', 'test');
    await actionIntentCreate(cwd, 'Intent B', 'test');
    const outFile = path.join(cwd, 'scoped-bundle.json');
    const result = await actionExport(cwd, outFile, [
      (a.data as { artifactId: string }).artifactId,
    ]);
    expect(result.ok).toBe(true);
    expect((result.data as { eventCount: number }).eventCount).toBe(1);
  });

  it('bootstraps trust from a Key artifact event during import', async () => {
    actionInit(cwd);
    const remoteKeyPair = generateKeyPair();
    const remoteActorId = generateId();
    const signer = {
      keyId: remoteKeyPair.keyId,
      publicKey: remoteKeyPair.publicKey,
      privateKey: remoteKeyPair.privateKey,
    };

    const unsignedArtifact = {
      artifact_id: generateId(),
      schema_version: '1.0',
      protocol_version: 'act/1.0',
      authoring_actor: { actor_id: remoteActorId, key_id: remoteKeyPair.keyId },
      created_at_claim: '2026-07-16T00:00:00Z',
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
      applicable_policy: { not_applicable: true, reason: 'test' },
      confidence_assessments: [],
      uncertainties: [],
      evidence_refs: [],
      sensitivity: 'internal',
      retention_policy_id: null,
      data: {
        key_id: remoteKeyPair.keyId,
        algorithm: 'ed25519',
        public_key: remoteKeyPair.publicKey,
        status: 'active',
        owner_actor_id: remoteActorId,
      },
    };
    const versionId = digestBytes(canonicalize(unsignedArtifact));
    const artifactSignature = signBytes(
      signer.privateKey,
      signer.publicKey,
      new TextEncoder().encode(canonicalize(unsignedArtifact)),
    );
    const artifact = {
      ...unsignedArtifact,
      version_id: versionId,
      signatures: [{ key_id: signer.keyId, algorithm: 'ed25519', signature: artifactSignature }],
    };

    const event = buildUnsignedEvent({
      eventType: 'genesis',
      actor: { actorId: remoteActorId, keyId: signer.keyId },
      tenant: { not_applicable: true, reason: 'test' },
      subject: {
        kind: 'artifact',
        artifact_id: unsignedArtifact.artifact_id,
        version_id: versionId,
        artifact_type: 'Key',
      },
      payload: artifact,
    });
    const envelope = signEnvelope(event, [signer]);

    const bundleFile = path.join(cwd, 'key-bundle.json');
    writeFileSync(
      bundleFile,
      JSON.stringify({
        bundle_id: `sha-256:${'7'.repeat(64)}`,
        source_ledger_id: remoteActorId,
        exported_at: '2026-07-16T00:00:00Z',
        events: [
          {
            signed_envelope: envelope,
            source_receipt: {
              ledger_id: remoteActorId,
              sequence: 0,
              event_id: envelope.payloadDigest,
              accepted_at: '2026-07-16T00:00:00Z',
              previous_receipt_digest: `sha-256:${'0'.repeat(64)}`,
              receipt_digest: `sha-256:${'1'.repeat(64)}`,
              signature: { key_id: signer.keyId, algorithm: 'ed25519', signature: 'ZmFrZQ==' },
            },
          },
        ],
        completeness: { scope: 'complete', known_gaps: [] },
        signature: { key_id: signer.keyId, algorithm: 'ed25519', signature: 'ZmFrZQ==' },
      }),
    );

    const result = await actionImport(cwd, bundleFile);
    expect(result.ok).toBe(true);
    expect((result.data as { accepted: number }).accepted).toBe(1);
    const trustedKeys = actionKeyList(cwd).data as Record<string, string>;
    expect(trustedKeys[remoteKeyPair.keyId]).toBe(remoteKeyPair.publicKey);
  });
});

describe('actionProjectionRebuild', () => {
  it('rebuilds without error', async () => {
    actionInit(cwd);
    await actionIntentCreate(cwd, 'Intent A', 'test');
    const result = await actionProjectionRebuild(cwd);
    expect(result.ok).toBe(true);
  });
});

describe('actionBackup / actionRestore', () => {
  it('backs up and restores the ledger database', async () => {
    actionInit(cwd);
    await actionIntentCreate(cwd, 'Intent A', 'test');
    const backupFile = path.join(cwd, 'backup.db');
    const backupResult = actionBackup(cwd, backupFile);
    expect(backupResult.ok).toBe(true);

    const restoreResult = actionRestore(cwd, backupFile);
    expect(restoreResult.ok).toBe(true);
  });

  it('reports an error restoring from a missing file', () => {
    actionInit(cwd);
    const result = actionRestore(cwd, path.join(cwd, 'nope.db'));
    expect(result.ok).toBe(false);
  });
});
