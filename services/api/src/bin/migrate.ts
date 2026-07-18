#!/usr/bin/env node
/**
 * Standalone migration entrypoint: applies pending schema migrations and
 * exits, without starting the HTTP server. `createLedgerContext` already
 * migrates idempotently on every server boot (see ledger-context.ts), so
 * this isn't required for correctness -- it exists so a Kubernetes/Helm
 * "migration Job" (deploy/helm/act/templates/migration-job.yaml) can run
 * migrations once, before rolling out new API replicas, rather than
 * relying on whichever replica happens to boot first.
 */
import { createLedgerContext } from '../ledger-context.js';

export async function runMigration(
  dbPath = process.env.ACT_DB_PATH ?? './data/act.db',
): Promise<string> {
  const ctx = await createLedgerContext(dbPath);
  return ctx.ledgerId;
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  runMigration()
    .then((ledgerId) => console.log(`Migrations applied to ledger ${ledgerId}.`))
    .catch((err) => {
      console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
      process.exit(1);
    });
}
