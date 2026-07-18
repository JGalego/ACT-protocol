import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { canonicalize, digestBytes, generateId, SCHEMA_IDS, validateAgainst } from '@act/core';
import { signBytes, signEnvelope, verifyEnvelope } from '@act/crypto';
import { verifyEventIntegrity, verifyReceiptChain } from '@act/verification';
import { buildUnsignedEvent } from '@act/sdk';
import { initWorkspace, loadWorkspace, trustKey, type Workspace } from './workspace.js';
import { openWorkspaceLedger, workspacePublicKeys } from './ledger-factory.js';

export interface ActionResult {
  ok: boolean;
  data: unknown;
}

function buildArtifactEnvelope(
  workspace: Workspace,
  artifactType: string,
  data: Record<string, unknown>,
) {
  const unsigned = {
    artifact_id: generateId(),
    schema_version: '1.0',
    protocol_version: 'act/1.0',
    authoring_actor: { actor_id: workspace.config.actorId, key_id: workspace.config.keyId },
    created_at_claim: new Date().toISOString(),
    artifact_type: artifactType,
    content: {
      media_type: 'application/json',
      byte_length: 0,
      digest: `sha-256:${'0'.repeat(64)}`,
      storage: { kind: 'inline' as const, inline_value: '' },
      sensitivity: 'internal' as const,
      availability_state: 'available' as const,
    },
    lineage: [],
    applicable_policy: {
      not_applicable: true as const,
      reason: 'act CLI local workspace: no policy configured',
    },
    confidence_assessments: [],
    uncertainties: [],
    evidence_refs: [],
    sensitivity: 'internal' as const,
    retention_policy_id: null,
    data,
  };
  const versionId = digestBytes(canonicalize(unsigned));
  const signature = signBytes(
    workspace.privateKey,
    workspace.config.publicKey,
    new TextEncoder().encode(canonicalize(unsigned)),
  );
  return {
    ...unsigned,
    version_id: versionId,
    signatures: [{ key_id: workspace.config.keyId, algorithm: 'ed25519' as const, signature }],
  };
}

export function actionInit(cwd: string): ActionResult {
  const workspace = initWorkspace(cwd);
  return {
    ok: true,
    data: {
      workspaceDir: workspace.dir,
      actorId: workspace.config.actorId,
      keyId: workspace.config.keyId,
      publicKey: workspace.config.publicKey,
      ledgerId: workspace.config.ledgerId,
    },
  };
}

export async function actionDoctor(cwd: string): Promise<ActionResult> {
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  checks.push({ name: 'node-version', ok: true, detail: process.version });
  let workspace: Workspace | undefined;
  try {
    workspace = loadWorkspace(cwd);
    checks.push({ name: 'workspace-config', ok: true, detail: workspace.dir });
  } catch (err) {
    checks.push({
      name: 'workspace-config',
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
  if (workspace) {
    try {
      const ledger = await openWorkspaceLedger(workspace);
      const events = await ledger.listEvents(1);
      checks.push({
        name: 'ledger-readable',
        ok: true,
        detail: `${events.length} event(s) sampled`,
      });
    } catch (err) {
      checks.push({
        name: 'ledger-readable',
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { ok: checks.every((c) => c.ok), data: { checks } };
}

export function actionWhoami(cwd: string): ActionResult {
  const workspace = loadWorkspace(cwd);
  return { ok: true, data: workspace.config };
}

export function actionKeyList(cwd: string): ActionResult {
  const workspace = loadWorkspace(cwd);
  return { ok: true, data: workspacePublicKeys(workspace) };
}

export function actionKeyTrust(cwd: string, keyId: string, publicKey: string): ActionResult {
  const workspace = loadWorkspace(cwd);
  trustKey(workspace, keyId, publicKey);
  return { ok: true, data: { keyId } };
}

export async function actionIntentCreate(
  cwd: string,
  statement: string,
  scope: string,
): Promise<ActionResult> {
  const workspace = loadWorkspace(cwd);
  const ledger = await openWorkspaceLedger(workspace);
  const artifact = buildArtifactEnvelope(workspace, 'Intent', { statement, scope });
  const event = buildUnsignedEvent({
    eventType: 'genesis',
    actor: { actorId: workspace.config.actorId, keyId: workspace.config.keyId },
    tenant: { not_applicable: true, reason: 'local workspace' },
    subject: {
      kind: 'artifact',
      artifact_id: artifact.artifact_id,
      version_id: artifact.version_id,
      artifact_type: 'Intent',
    },
    payload: artifact,
  });
  const envelope = signEnvelope(event, [
    {
      keyId: workspace.config.keyId,
      publicKey: workspace.config.publicKey,
      privateKey: workspace.privateKey,
    },
  ]);
  const result = await ledger.appendEvent(envelope, {
    publicKeys: workspacePublicKeys(workspace),
  });
  return {
    ok: true,
    data: {
      artifactId: artifact.artifact_id,
      versionId: artifact.version_id,
      eventId: result.event.eventId,
      sequence: result.receipt.sequence,
    },
  };
}

export async function actionVerify(cwd: string): Promise<ActionResult> {
  const workspace = loadWorkspace(cwd);
  const ledger = await openWorkspaceLedger(workspace);
  const publicKeys = workspacePublicKeys(workspace);
  const events = await ledger.listEvents(100_000);

  const findings = events.flatMap((e) => verifyEventIntegrity(e.envelope, publicKeys));

  const receipts = (await Promise.all(events.map((e) => ledger.getReceipt(e.sequence)))).filter(
    (r): r is NonNullable<typeof r> => r !== null,
  );
  const chainFindings = verifyReceiptChain(receipts, workspace.config.publicKey);

  const allFindings = [...findings, ...chainFindings];
  return {
    ok: allFindings.length === 0,
    data: { eventsChecked: events.length, findings: allFindings },
  };
}

export async function actionLineage(
  cwd: string,
  eventId: string,
  maxDepth?: number,
): Promise<ActionResult> {
  const workspace = loadWorkspace(cwd);
  const ledger = await openWorkspaceLedger(workspace);
  if (!(await ledger.getEvent(eventId))) {
    return { ok: false, data: { error: `No event found with id ${eventId}` } };
  }
  return { ok: true, data: await ledger.getLineage(eventId, maxDepth) };
}

export async function actionHistory(cwd: string, artifactId: string): Promise<ActionResult> {
  const workspace = loadWorkspace(cwd);
  const ledger = await openWorkspaceLedger(workspace);
  return {
    ok: true,
    data: { artifactId, items: await ledger.listEventsForArtifact(artifactId) },
  };
}

export async function actionExport(
  cwd: string,
  outFile: string,
  artifactIds?: string[],
): Promise<ActionResult> {
  const workspace = loadWorkspace(cwd);
  const ledger = await openWorkspaceLedger(workspace);
  const events =
    artifactIds && artifactIds.length > 0
      ? (await Promise.all(artifactIds.map((id) => ledger.listEventsForArtifact(id)))).flat()
      : await ledger.listEvents(1_000_000);

  const bundleEvents = await Promise.all(
    events.map(async (e) => ({
      signed_envelope: e.envelope,
      source_receipt: await ledger.getReceipt(e.sequence),
    })),
  );
  const bundleBody = {
    source_ledger_id: workspace.config.ledgerId,
    exported_at: new Date().toISOString(),
    events: bundleEvents,
    completeness: { scope: 'complete' as const, known_gaps: [] as unknown[] },
  };
  const bundleId = digestBytes(canonicalize(bundleBody));
  const signature = signBytes(
    workspace.privateKey,
    workspace.config.publicKey,
    new TextEncoder().encode(bundleId),
  );
  const bundle = {
    bundle_id: bundleId,
    ...bundleBody,
    signature: { key_id: workspace.config.keyId, algorithm: 'ed25519' as const, signature },
  };

  writeFileSync(outFile, JSON.stringify(bundle, null, 2));
  return { ok: true, data: { outFile, eventCount: events.length } };
}

export async function actionImport(cwd: string, inFile: string): Promise<ActionResult> {
  const workspace = loadWorkspace(cwd);
  const ledger = await openWorkspaceLedger(workspace);
  if (!existsSync(inFile)) {
    return { ok: false, data: { error: `No such file: ${inFile}` } };
  }
  const bundle = JSON.parse(readFileSync(inFile, 'utf8'));
  const bundleResult = validateAgainst(SCHEMA_IDS.bundle, bundle);
  if (!bundleResult.valid) {
    return {
      ok: false,
      data: { error: 'Bundle failed schema validation', details: bundleResult.errors },
    };
  }

  let accepted = 0;
  let duplicate = 0;
  const quarantined: string[] = [];
  for (const item of bundle.events as { signed_envelope: any }[]) {
    try {
      const envelope = item.signed_envelope;
      const keyPayload = envelope.payload?.payload;
      if (keyPayload?.artifact_type === 'Key' && keyPayload.data?.public_key) {
        const check = verifyEnvelope(envelope, {
          [keyPayload.data.key_id]: keyPayload.data.public_key,
        });
        if (
          check.digestValid &&
          check.signatures.some((s) => s.key_id === keyPayload.data.key_id && s.valid)
        ) {
          trustKey(workspace, keyPayload.data.key_id, keyPayload.data.public_key);
        }
      }
      const result = await ledger.appendEvent(envelope, {
        publicKeys: workspacePublicKeys(workspace),
        allowPartialImport: true,
      });
      if (result.duplicate) duplicate++;
      else accepted++;
    } catch (err) {
      await ledger.quarantine(
        err instanceof Error ? err.message : 'unknown import failure',
        item.signed_envelope,
      );
      quarantined.push(String(item.signed_envelope?.payloadDigest ?? 'unknown'));
    }
  }
  return { ok: true, data: { accepted, duplicate, quarantined } };
}

export async function actionProjectionRebuild(cwd: string): Promise<ActionResult> {
  const workspace = loadWorkspace(cwd);
  const ledger = await openWorkspaceLedger(workspace);
  await ledger.rebuildProjections();
  return { ok: true, data: { rebuilt: true } };
}

export function actionBackup(cwd: string, destFile: string): ActionResult {
  const workspace = loadWorkspace(cwd);
  copyFileSync(workspace.dbPath, destFile);
  return { ok: true, data: { destFile } };
}

export function actionRestore(cwd: string, srcFile: string): ActionResult {
  const workspace = loadWorkspace(cwd);
  if (!existsSync(srcFile)) {
    return { ok: false, data: { error: `No such file: ${srcFile}` } };
  }
  copyFileSync(srcFile, workspace.dbPath);
  return { ok: true, data: { restoredFrom: srcFile } };
}
