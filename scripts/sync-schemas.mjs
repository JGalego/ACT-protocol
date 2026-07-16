#!/usr/bin/env node
// Copies the repository's authoritative /schemas directory into
// packages/core/schemas so packages/core ships and resolves schemas
// without a monorepo-relative path assumption at runtime. Run automatically
// via pnpm's pre-build/pre-test lifecycle hooks in packages/core/package.json.
import { cpSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const SRC = path.join(ROOT, 'schemas');
const DEST = path.join(ROOT, 'packages/core/schemas');

if (existsSync(DEST)) rmSync(DEST, { recursive: true, force: true });
cpSync(SRC, DEST, {
  recursive: true,
  filter: (src) =>
    !src.includes(`${path.sep}fixtures${path.sep}`) && !src.endsWith(`${path.sep}fixtures`),
});
console.log(`Synced schemas/ -> packages/core/schemas`);
