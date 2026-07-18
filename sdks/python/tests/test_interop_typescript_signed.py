"""Proves act_sdk.crypto can verify a signature it never produced, over a
fixture checked into git that packages/crypto generated
(conformance/interop/generate-typescript-signed.ts). This is the other half
of the SDK conformance profile's "verify any other conformant SDK"
requirement (spec/conformance.md section 1) -- see
conformance/checks/sdk-interop.ts, which runs this exact verification (via
conformance/interop/verify-typescript-signed.py) as part of the main
conformance report.
"""

import json
from pathlib import Path

from act_sdk.crypto import verify_bytes, verify_envelope
from act_sdk.crypto.dsse import EnvelopeSignature, SignedEnvelope

FIXTURE_PATH = (
    Path(__file__).resolve().parents[3] / "conformance" / "interop" / "typescript-signed.json"
)


def _load_fixture():
    with open(FIXTURE_PATH, encoding="utf-8") as f:
        return json.load(f)


def test_verifies_a_raw_signature_produced_by_typescript():
    fixture = _load_fixture()
    raw = fixture["rawSignature"]
    message = raw["messageUtf8"].encode("utf-8")
    assert verify_bytes(raw["publicKeyBase64"], message, raw["signatureBase64"]) is True


def test_verifies_a_full_envelope_produced_by_typescript():
    fixture = _load_fixture()
    env = fixture["envelope"]
    envelope = SignedEnvelope(
        payload_type=env["payloadType"],
        payload=env["payload"],
        payload_digest=env["payloadDigest"],
        signatures=[
            EnvelopeSignature(
                key_id=s["key_id"], algorithm=s["algorithm"], signature=s["signature"]
            )
            for s in env["signatures"]
        ],
    )
    result = verify_envelope(
        envelope, {env["signatures"][0]["key_id"]: env["signerPublicKeyBase64"]}
    )
    assert result.digest_valid is True
    assert all(s.valid for s in result.signatures)
