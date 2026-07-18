import { describe, expect, it } from 'vitest';
import { verifyBytes, verifyEnvelope, type SignedEnvelope } from '@act/crypto';
import fixture from './python-signed.json';

// Proves @act/crypto can verify a signature it never produced, over a
// fixture checked into git that sdks/python's act_sdk.crypto generated
// (conformance/interop/generate-python-signed.py). This is the other half
// of the SDK conformance profile's "verify any other conformant SDK"
// requirement -- see conformance/checks/sdk-interop.ts for the direction
// this test can't cover (Python verifying a TypeScript signature), which
// necessarily shells out to a real Python process instead.
describe('cross-language interop: @act/crypto verifies sdks/python-signed data', () => {
  it('verifies a raw Ed25519 signature produced by sdks/python', () => {
    const message = new TextEncoder().encode(fixture.rawSignature.messageUtf8);
    expect(
      verifyBytes(
        fixture.rawSignature.publicKeyBase64,
        message,
        fixture.rawSignature.signatureBase64,
      ),
    ).toBe(true);
  });

  it('verifies a full signed envelope produced by sdks/python', () => {
    const result = verifyEnvelope(fixture.envelope as unknown as SignedEnvelope, {
      [fixture.envelope.signatures[0]!.key_id]: fixture.envelope.signerPublicKeyBase64,
    });
    expect(result.digestValid).toBe(true);
    expect(result.signatures.every((s) => s.valid)).toBe(true);
  });
});
