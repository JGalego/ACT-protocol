import { Ledger, SqliteAdapter, type TrustPolicy } from '@act/ledger';
import { loadKeyOwners, loadTrustedKeys, type Workspace } from './workspace.js';

export async function openWorkspaceLedger(workspace: Workspace): Promise<Ledger> {
  const adapter = SqliteAdapter.open(workspace.dbPath);
  await adapter.migrate();
  // Re-reads trusted-keys.json on every check (rather than a snapshot taken
  // once at construction) so that a key trusted mid-import -- e.g. via a Key
  // artifact event's own proof-of-possession bootstrap -- is honored by the
  // very next event in the same import batch.
  // An event is trusted only if its key is trusted AND that key belongs to the
  // actor the event names; otherwise any trusted key could author events as anyone.
  const trustPolicy: TrustPolicy = {
    isTrusted: (actorId: string, keyId: string) =>
      keyId in loadTrustedKeys(workspace) && loadKeyOwners(workspace)[keyId] === actorId,
    isKeyTrusted: (keyId: string) => keyId in loadTrustedKeys(workspace),
  };
  return new Ledger({
    ledgerId: workspace.config.ledgerId,
    adapter,
    signer: {
      keyId: workspace.config.keyId,
      publicKey: workspace.config.publicKey,
      privateKey: workspace.privateKey,
    },
    trustPolicy,
  });
}

export function workspacePublicKeys(workspace: Workspace): Record<string, string> {
  return loadTrustedKeys(workspace);
}
