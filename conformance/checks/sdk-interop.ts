import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { verifyBytes, verifyEnvelope, type SignedEnvelope } from '@act/crypto';
import type { CheckResult } from './types.js';

const INTEROP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'interop');
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface InteropFixture {
  generatedBy: string;
  rawSignature: { publicKeyBase64: string; messageUtf8: string; signatureBase64: string };
  envelope: {
    payloadType: string;
    payload: Record<string, unknown>;
    payloadDigest: string;
    signatures: { key_id: string; algorithm: string; signature: string }[];
    signerPublicKeyBase64: string;
  };
}

function loadFixture(name: string): InteropFixture {
  return JSON.parse(readFileSync(join(INTEROP_DIR, name), 'utf-8')) as InteropFixture;
}

/**
 * SDK profile (spec/conformance.md section 1): "verification of signatures
 * produced by any other conformant SDK." Both directions below are
 * genuinely executed here, not asserted from prose: direction 1 calls
 * @act/crypto in-process against a fixture sdks/python produced; direction
 * 2 shells out to a real Python process (conformance/interop/verify-
 * typescript-signed.py) against a fixture @act/crypto produced, since
 * these two runtimes can't share an in-process call the way this
 * repository's other checks do.
 */
export function run(): CheckResult[] {
  return [...checkTypeScriptVerifiesPython(), ...checkPythonVerifiesTypeScript()];
}

function checkTypeScriptVerifiesPython(): CheckResult[] {
  try {
    const fixture = loadFixture('python-signed.json');
    const message = new TextEncoder().encode(fixture.rawSignature.messageUtf8);
    const rawOk = verifyBytes(
      fixture.rawSignature.publicKeyBase64,
      message,
      fixture.rawSignature.signatureBase64,
    );
    const envelopeResult = verifyEnvelope(fixture.envelope as unknown as SignedEnvelope, {
      [fixture.envelope.signatures[0]!.key_id]: fixture.envelope.signerPublicKeyBase64,
    });
    const envelopeOk =
      envelopeResult.digestValid && envelopeResult.signatures.every((s) => s.valid);
    return [
      {
        id: 'sdk-interop/typescript-verifies-python-raw-signature',
        category: 'sdk-interop',
        profile: 'sdk',
        expected: 'true',
        actual: String(rawOk),
        pass: rawOk,
      },
      {
        id: 'sdk-interop/typescript-verifies-python-envelope',
        category: 'sdk-interop',
        profile: 'sdk',
        expected: 'digestValid=true, all signatures valid',
        actual: `digestValid=${envelopeResult.digestValid}, signatures=${JSON.stringify(envelopeResult.signatures)}`,
        pass: envelopeOk,
      },
    ];
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return [
      {
        id: 'sdk-interop/typescript-verifies-python',
        category: 'sdk-interop',
        profile: 'sdk',
        expected: 'fixture loads and verifies',
        actual: detail,
        pass: false,
      },
    ];
  }
}

function checkPythonVerifiesTypeScript(): CheckResult[] {
  try {
    const output = execFileSync('python3', [join(INTEROP_DIR, 'verify-typescript-signed.py')], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
    });
    const pass = output.trim().endsWith('OK');
    return [
      {
        id: 'sdk-interop/python-verifies-typescript',
        category: 'sdk-interop',
        profile: 'sdk',
        expected: 'OK',
        actual: output.trim(),
        pass,
      },
    ];
  } catch (err) {
    const detail =
      err && typeof err === 'object' && 'stdout' in err
        ? String((err as { stdout?: string }).stdout)
        : err instanceof Error
          ? err.message
          : String(err);
    return [
      {
        id: 'sdk-interop/python-verifies-typescript',
        category: 'sdk-interop',
        profile: 'sdk',
        expected: 'OK',
        actual: detail,
        pass: false,
      },
    ];
  }
}
