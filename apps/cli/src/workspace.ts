import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { generateId } from '@act/core';
import { generateKeyPair, type KeyPair } from '@act/crypto';

export interface WorkspaceConfig {
  ledgerId: string;
  actorId: string;
  keyId: string;
  publicKey: string;
  createdAt: string;
}

export interface Workspace {
  dir: string;
  dbPath: string;
  configPath: string;
  keyPath: string;
  trustedKeysPath: string;
  config: WorkspaceConfig;
  privateKey: string;
}

const WORKSPACE_DIR_NAME = '.act';

export function workspacePaths(cwd: string) {
  const dir = path.join(cwd, WORKSPACE_DIR_NAME);
  return {
    dir,
    dbPath: path.join(dir, 'ledger.db'),
    configPath: path.join(dir, 'config.json'),
    keyPath: path.join(dir, 'identity.key.json'),
    trustedKeysPath: path.join(dir, 'trusted-keys.json'),
  };
}

export class WorkspaceNotFoundError extends Error {
  constructor(dir: string) {
    super(`No ACT workspace found at ${dir}. Run 'act init' first.`);
    this.name = 'WorkspaceNotFoundError';
  }
}

/**
 * Initializes a new local ACT workspace: generates an Ed25519 identity for
 * the local actor and writes the workspace config. The private key is
 * stored in plaintext under .act/ -- this is a local development
 * convenience, explicitly NOT a production credential store (see
 * docs/security-and-privacy-guide.md).
 */
export function initWorkspace(cwd: string): Workspace {
  const paths = workspacePaths(cwd);
  if (existsSync(paths.configPath)) {
    throw new Error(`A workspace already exists at ${paths.dir}`);
  }
  mkdirSync(paths.dir, { recursive: true });

  const keyPair: KeyPair = generateKeyPair();
  const config: WorkspaceConfig = {
    ledgerId: generateId(),
    actorId: generateId(),
    keyId: keyPair.keyId,
    publicKey: keyPair.publicKey,
    createdAt: new Date().toISOString(),
  };

  writeFileSync(paths.configPath, JSON.stringify(config, null, 2));
  writeFileSync(paths.keyPath, JSON.stringify({ privateKey: keyPair.privateKey }, null, 2), {
    mode: 0o600,
  });
  writeFileSync(
    paths.trustedKeysPath,
    JSON.stringify({ [config.keyId]: config.publicKey }, null, 2),
  );

  return { ...paths, config, privateKey: keyPair.privateKey };
}

export function loadWorkspace(cwd: string): Workspace {
  const paths = workspacePaths(cwd);
  if (!existsSync(paths.configPath)) {
    throw new WorkspaceNotFoundError(paths.dir);
  }
  const config = JSON.parse(readFileSync(paths.configPath, 'utf8')) as WorkspaceConfig;
  const { privateKey } = JSON.parse(readFileSync(paths.keyPath, 'utf8')) as { privateKey: string };
  return { ...paths, config, privateKey };
}

export function loadTrustedKeys(workspace: Workspace): Record<string, string> {
  if (!existsSync(workspace.trustedKeysPath)) return {};
  return JSON.parse(readFileSync(workspace.trustedKeysPath, 'utf8')) as Record<string, string>;
}

export function trustKey(workspace: Workspace, keyId: string, publicKey: string): void {
  const trusted = loadTrustedKeys(workspace);
  trusted[keyId] = publicKey;
  writeFileSync(workspace.trustedKeysPath, JSON.stringify(trusted, null, 2));
}
