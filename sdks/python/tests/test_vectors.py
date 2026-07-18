"""Proves this Python implementation matches the same generated vectors
`conformance/vectors/vectors.test.ts` checks the TypeScript implementation
against -- the single source of truth every SDK's conformance suite loads
(`conformance/vectors/README.md`), so this SDK can never silently drift
from `packages/core`/`packages/crypto`'s actual byte output.
"""

import base64

from act_sdk.core import (
    canonicalize,
    digest_bytes,
    digest_canonical_value,
    is_freshly_generated_id,
    is_valid_id,
)
from act_sdk.crypto import (
    KeyStatusEvent,
    Signer,
    evaluate_key_validity_at,
    key_id_for,
    pre_auth_encode,
    sign_envelope,
    verify_bytes,
)


def test_canonicalization_structural(canonicalization_vectors):
    for case in canonicalization_vectors["structural"]:
        assert canonicalize(case["input"]) == case["expectedCanonical"], case["id"]


def test_canonicalization_numbers(canonicalization_vectors):
    for case in canonicalization_vectors["numbers"]:
        assert canonicalize({"n": case["input"]}) == case["expectedCanonical"], case["id"]


def test_digest_bytes(digest_vectors):
    for case in digest_vectors["bytes"]:
        assert digest_bytes(case["input"]) == case["expectedDigest"], case["id"]


def test_digest_canonical_values(digest_vectors):
    for case in digest_vectors["canonicalValues"]:
        assert canonicalize(case["input"]) == case["expectedCanonical"], case["id"]
        assert digest_canonical_value(case["input"]) == case["expectedDigest"], case["id"]


def test_ids(ids_vectors):
    for case in ids_vectors["validUuidV7"] + ids_vectors["invalid"]:
        assert is_valid_id(case["id"]) == case["expectedValid"], case["id"]
        assert is_freshly_generated_id(case["id"]) == case["expectedFreshlyGenerated"], case["id"]


def test_dsse_pae(dsse_pae_vectors):
    for case in dsse_pae_vectors["cases"]:
        pae = pre_auth_encode(case["payloadType"], case["payloadUtf8"].encode("utf-8"))
        assert base64.b64encode(pae).decode("ascii") == case["expectedPaeBase64"], case["id"]


def test_key_ids(keys_vectors):
    for case in keys_vectors["keyPairs"]:
        assert key_id_for(case["publicKeyBase64"]) == case["expectedKeyId"], case["id"]


def test_signatures(signatures_vectors):
    for case in signatures_vectors["cases"]:
        message = case["messageUtf8"].encode("utf-8")
        result = verify_bytes(case["publicKeyBase64"], message, case["expectedSignatureBase64"])
        assert result == case["expectedVerifyResult"], case["id"]


def test_envelopes(envelopes_vectors):
    for case in envelopes_vectors["cases"]:
        signer = Signer(
            key_id=case["expectedSignatures"][0]["key_id"],
            public_key=case["signerPublicKeyBase64"],
            private_key=case["signerPrivateKeyBase64"],
        )
        envelope = sign_envelope(case["payload"], [signer])
        assert envelope.payload_digest == case["expectedPayloadDigest"], case["id"]


def test_key_lifecycle(key_lifecycle_vectors):
    for case in key_lifecycle_vectors["cases"]:
        history = [
            KeyStatusEvent(status=e["status"], effective_at=e["effectiveAt"])
            for e in case["history"]
        ]
        options = case.get("options") or {}
        result = evaluate_key_validity_at(
            history,
            case["queryTimeIso"],
            options.get("compromiseGracePeriodMs"),
        )
        expected = case["expected"]
        assert result.status_at_time == expected["statusAtTime"], case["id"]
        assert result.valid_for_signing == expected["validForSigning"], case["id"]
        assert result.reason == expected["reason"], case["id"]
