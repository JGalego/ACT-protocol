#!/usr/bin/env node
import { Command } from 'commander';
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
  type ActionResult,
} from '../actions.js';

const program = new Command();
program.name('act').description('ACT protocol command-line tool').version('1.0.0-rc.1');

function emit(result: ActionResult, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result.data, null, 2));
  } else {
    console.log(
      typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2),
    );
  }
  if (!result.ok) process.exitCode = 1;
}

function run(fn: () => ActionResult, json: boolean): void {
  try {
    emit(fn(), json);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (json) {
      console.log(JSON.stringify({ error: message }, null, 2));
    } else {
      console.error(`Error: ${message}`);
    }
    process.exitCode = 1;
  }
}

program
  .command('init')
  .description('Initialize a local ACT workspace in the current directory')
  .option('--json', 'output JSON')
  .action((opts) => run(() => actionInit(process.cwd()), opts.json));

program
  .command('doctor')
  .description('Check environment and workspace health')
  .option('--json', 'output JSON')
  .action((opts) => run(() => actionDoctor(process.cwd()), opts.json));

const actorCmd = program.command('actor').description('Actor identity commands');
actorCmd
  .command('whoami')
  .description('Show the local workspace actor')
  .option('--json', 'output JSON')
  .action((opts) => run(() => actionWhoami(process.cwd()), opts.json));

const keyCmd = program.command('key').description('Key management commands');
keyCmd
  .command('list')
  .description('List trusted keys in this workspace')
  .option('--json', 'output JSON')
  .action((opts) => run(() => actionKeyList(process.cwd()), opts.json));
keyCmd
  .command('trust <keyId> <publicKey>')
  .description('Trust an externally-provided public key')
  .option('--json', 'output JSON')
  .action((keyId, publicKey, opts) =>
    run(() => actionKeyTrust(process.cwd(), keyId, publicKey), opts.json),
  );

const intentCmd = program.command('intent').description('Intent commands');
intentCmd
  .command('create <statement>')
  .description('Create a new root Intent')
  .option('--scope <scope>', 'scope of the intent', 'default')
  .option('--json', 'output JSON')
  .action((statement, opts) =>
    run(() => actionIntentCreate(process.cwd(), statement, opts.scope), opts.json),
  );

program
  .command('verify')
  .description('Run the verification toolkit against the local ledger')
  .option('--json', 'output JSON')
  .action((opts) => run(() => actionVerify(process.cwd()), opts.json));

program
  .command('lineage <eventId>')
  .description('Show bounded lineage (ancestors/descendants) around an event')
  .option('--max-depth <n>', 'maximum traversal depth', (v) => Number(v))
  .option('--json', 'output JSON')
  .action((eventId, opts) =>
    run(() => actionLineage(process.cwd(), eventId, opts.maxDepth), opts.json),
  );

program
  .command('history <artifactId>')
  .description('Show the full version history of a logical artifact')
  .option('--json', 'output JSON')
  .action((artifactId, opts) => run(() => actionHistory(process.cwd(), artifactId), opts.json));

program
  .command('export <outFile>')
  .description('Export a signed event bundle')
  .option('--artifact <id...>', 'restrict export to these artifact ids')
  .option('--json', 'output JSON')
  .action((outFile, opts) =>
    run(() => actionExport(process.cwd(), outFile, opts.artifact), opts.json),
  );

program
  .command('import <inFile>')
  .description('Import a signed event bundle, quarantining anything invalid')
  .option('--json', 'output JSON')
  .action((inFile, opts) => run(() => actionImport(process.cwd(), inFile), opts.json));

program
  .command('projection')
  .description('Projection maintenance commands')
  .command('rebuild')
  .description('Rebuild all projections solely from the accepted event log')
  .option('--json', 'output JSON')
  .action((opts) => run(() => actionProjectionRebuild(process.cwd()), opts.json));

program
  .command('backup <destFile>')
  .description('Copy the local ledger database to destFile')
  .option('--json', 'output JSON')
  .action((destFile, opts) => run(() => actionBackup(process.cwd(), destFile), opts.json));

program
  .command('restore <srcFile>')
  .description('Restore the local ledger database from srcFile')
  .requiredOption('--yes', 'confirm this destructive, irreversible operation')
  .option('--json', 'output JSON')
  .action((srcFile, opts) => run(() => actionRestore(process.cwd(), srcFile), opts.json));

program.parseAsync(process.argv);
