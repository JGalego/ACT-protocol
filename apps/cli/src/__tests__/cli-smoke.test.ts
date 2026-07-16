import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_BIN = path.resolve(__dirname, '../../dist/bin/act.js');

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(path.join(os.tmpdir(), 'act-cli-smoke-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function act(args: string[]): { stdout: string; status: number } {
  try {
    const stdout = execFileSync(process.execPath, [CLI_BIN, ...args], { cwd, encoding: 'utf8' });
    return { stdout, status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; status?: number };
    return { stdout: e.stdout ?? '', status: e.status ?? 1 };
  }
}

describe('act CLI (subprocess smoke test)', () => {
  it('runs init, whoami, and intent create end-to-end', () => {
    const init = act(['init', '--json']);
    expect(init.status).toBe(0);
    const initData = JSON.parse(init.stdout);
    expect(initData.actorId).toBeTruthy();

    const whoami = act(['actor', 'whoami', '--json']);
    expect(whoami.status).toBe(0);
    expect(JSON.parse(whoami.stdout).actorId).toBe(initData.actorId);

    const intent = act(['intent', 'create', 'Ship it', '--json']);
    expect(intent.status).toBe(0);
    expect(JSON.parse(intent.stdout).sequence).toBe(0);

    const verify = act(['verify', '--json']);
    expect(verify.status).toBe(0);
    expect(JSON.parse(verify.stdout).findings).toEqual([]);
  }, 20_000); // the default 5s timeout is too tight. // Spawns 4 real Node subprocesses; under parallel workspace test load

  it('exits non-zero with a helpful error when run outside a workspace', () => {
    const result = act(['actor', 'whoami', '--json']);
    expect(result.status).toBe(1);
  });
});
