import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  canonicalize,
  digestBytes,
  digestCanonicalValue,
  isFreshlyGeneratedId,
  isValidId,
} from '@act/core';
import type { CheckResult } from './types.js';

const VECTORS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'vectors');
function loadVector<T>(name: string): T {
  return JSON.parse(readFileSync(join(VECTORS_DIR, `${name}.json`), 'utf8')) as T;
}

interface CanonicalizationVectors {
  structural: { id: string; input: unknown; expectedCanonical: string }[];
  numbers: { id: string; input: number; expectedCanonical: string }[];
}
interface DigestVectors {
  bytes: { id: string; input: string; expectedDigest: string }[];
  canonicalValues: { id: string; input: unknown; expectedDigest: string }[];
}
interface IdVectors {
  validUuidV7: { id: string; expectedValid: boolean; expectedFreshlyGenerated: boolean }[];
  invalid: { id: string; expectedValid: boolean; expectedFreshlyGenerated: boolean }[];
}

/** Core profile: RFC 8785 canonicalization + identifier derivation (spec/conformance.md section 1). */
export function run(): CheckResult[] {
  const results: CheckResult[] = [];
  const canonicalization = loadVector<CanonicalizationVectors>('canonicalization');
  const digest = loadVector<DigestVectors>('digest');
  const ids = loadVector<IdVectors>('ids');

  for (const c of canonicalization.structural) {
    const actual = canonicalize(c.input);
    results.push({
      id: `canonicalization/${c.id}`,
      category: 'canonicalization',
      profile: 'core',
      expected: c.expectedCanonical,
      actual,
      pass: actual === c.expectedCanonical,
    });
  }
  for (const c of canonicalization.numbers) {
    const actual = canonicalize({ n: c.input });
    results.push({
      id: `canonicalization/number-${c.id}`,
      category: 'canonicalization',
      profile: 'core',
      expected: c.expectedCanonical,
      actual,
      pass: actual === c.expectedCanonical,
    });
  }

  for (const c of digest.bytes) {
    const actual = digestBytes(c.input);
    results.push({
      id: `digest/${c.id}`,
      category: 'identifier-derivation',
      profile: 'core',
      expected: c.expectedDigest,
      actual,
      pass: actual === c.expectedDigest,
    });
  }
  for (const c of digest.canonicalValues) {
    const actual = digestCanonicalValue(c.input);
    results.push({
      id: `digest/${c.id}`,
      category: 'identifier-derivation',
      profile: 'core',
      expected: c.expectedDigest,
      actual,
      pass: actual === c.expectedDigest,
    });
  }

  for (const c of [...ids.validUuidV7, ...ids.invalid]) {
    const actualValid = isValidId(c.id);
    const actualFresh = isFreshlyGeneratedId(c.id);
    const pass = actualValid === c.expectedValid && actualFresh === c.expectedFreshlyGenerated;
    results.push({
      id: `ids/${c.id || '(empty)'}`,
      category: 'identifier-derivation',
      profile: 'core',
      expected: JSON.stringify({ valid: c.expectedValid, fresh: c.expectedFreshlyGenerated }),
      actual: JSON.stringify({ valid: actualValid, fresh: actualFresh }),
      pass,
    });
  }

  return results;
}
