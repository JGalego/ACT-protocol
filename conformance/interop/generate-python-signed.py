#!/usr/bin/env python3
"""One-shot generator: signs real data with sdks/python's act_sdk.crypto and
writes it as language-neutral JSON, so packages/crypto (TypeScript) can
independently verify a signature it never produced -- the actual proof the
SDK conformance profile requires (spec/conformance.md section 1: "verification
of signatures produced by any other conformant SDK"), not merely two SDKs
each independently reproducing the same frozen vectors.

Unlike conformance/vectors/ (fixed inputs so every SDK reproduces identical
bytes), this uses a freshly generated keypair each run -- what's being
proven here is cross-verification, not byte-for-byte determinism, so a
fresh keypair is a stronger proof than a shared fixed one would be.

Re-run manually (`pnpm run conformance:generate-interop`, from repo root)
after a real change to sdks/python's crypto or packages/crypto's DSSE
behavior; this is checked into git like conformance/vectors/.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "sdks" / "python" / "src"))

from act_sdk.crypto import Signer, generate_key_pair, sign_bytes, sign_envelope  # noqa: E402

OUT_PATH = Path(__file__).resolve().parent / "python-signed.json"


def main() -> None:
    key_pair = generate_key_pair()

    message = "ACT cross-language interop: sdks/python signs, packages/crypto verifies"
    signature = sign_bytes(key_pair.private_key, message.encode("utf-8"))

    signer = Signer(
        key_id=key_pair.key_id,
        public_key=key_pair.public_key,
        private_key=key_pair.private_key,
    )
    payload = {
        "protocol_version": "act/1.0",
        "event_type": "genesis",
        "payload": {
            "origin": "sdks/python",
            "note": "signed by act_sdk.crypto, verified by @act/crypto",
        },
    }
    envelope = sign_envelope(payload, [signer])

    out = {
        "generatedBy": "sdks/python (act_sdk.crypto)",
        "rawSignature": {
            "publicKeyBase64": key_pair.public_key,
            "messageUtf8": message,
            "signatureBase64": signature,
        },
        "envelope": {
            "payloadType": envelope.payload_type,
            "payload": envelope.payload,
            "payloadDigest": envelope.payload_digest,
            "signatures": [
                {"key_id": s.key_id, "algorithm": s.algorithm, "signature": s.signature}
                for s in envelope.signatures
            ],
            "signerPublicKeyBase64": key_pair.public_key,
        },
    }

    OUT_PATH.write_text(
        json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
