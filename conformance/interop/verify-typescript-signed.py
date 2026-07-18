#!/usr/bin/env python3
"""Standalone verifier invoked as a subprocess by
conformance/checks/sdk-interop.ts, so the SDK conformance profile's
"Python verifies TypeScript" direction is actually executed by the main
conformance report -- not asserted from prose because the two runtimes
can't share an in-process call the way run-conformance.ts's other checks
do. Prints "OK" and exits 0 on success; prints a reason and exits non-zero
otherwise. Requires only `cryptography` installed (not the SDK's dev
dependencies) -- see the `verify` CI job in .github/workflows/ci.yml.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "sdks" / "python" / "src"))

from act_sdk.crypto import verify_bytes, verify_envelope  # noqa: E402
from act_sdk.crypto.dsse import EnvelopeSignature, SignedEnvelope  # noqa: E402

FIXTURE_PATH = Path(__file__).resolve().parent / "typescript-signed.json"


def main() -> int:
    fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

    raw = fixture["rawSignature"]
    message = raw["messageUtf8"].encode("utf-8")
    raw_ok = verify_bytes(raw["publicKeyBase64"], message, raw["signatureBase64"])
    if not raw_ok:
        print("FAIL: raw signature produced by @act/crypto did not verify")
        return 1

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
    if not result.digest_valid:
        print("FAIL: envelope payload digest produced by @act/crypto did not verify")
        return 1
    if not all(s.valid for s in result.signatures):
        print("FAIL: envelope signature produced by @act/crypto did not verify")
        return 1

    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
