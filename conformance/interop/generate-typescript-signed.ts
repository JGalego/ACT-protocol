#!/usr/bin/env -S node --import tsx
/**
 * Signs sample data with packages/crypto for Python cross-SDK verification.
 *
 * Run `pnpm run conformance:generate-interop` intentionally after crypto
 * changes: it generates a new keypair and replaces the checked-in fixture.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateKeyPair, signBytes, signEnvelope } from '@act/crypto';

const OUT_DIR = dirname(fileURLToPath(import.meta.url));

const keyPair = generateKeyPair();

const message = 'ACT cross-language interop: packages/crypto signs, sdks/python verifies';
const messageBytes = new TextEncoder().encode(message);
const signature = signBytes(keyPair.privateKey, keyPair.publicKey, messageBytes);

const payload = {
  protocol_version: 'act/1.0',
  event_type: 'genesis',
  payload: {
    origin: 'packages/crypto',
    note: 'signed by @act/crypto, verified by act_sdk.crypto',
  },
};
const envelope = signEnvelope(payload, [
  { keyId: keyPair.keyId, publicKey: keyPair.publicKey, privateKey: keyPair.privateKey },
]);

const out = {
  generatedBy: 'packages/crypto (@act/crypto)',
  rawSignature: {
    publicKeyBase64: keyPair.publicKey,
    messageUtf8: message,
    signatureBase64: signature,
  },
  envelope: {
    payloadType: envelope.payloadType,
    payload: envelope.payload,
    payloadDigest: envelope.payloadDigest,
    signatures: envelope.signatures,
    signerPublicKeyBase64: keyPair.publicKey,
  },
};

writeFileSync(join(OUT_DIR, 'typescript-signed.json'), JSON.stringify(out, null, 2) + '\n');
console.log('wrote conformance/interop/typescript-signed.json');
