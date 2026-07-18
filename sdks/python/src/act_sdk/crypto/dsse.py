"""Ports `packages/crypto/src/dsse.ts`."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..core.canonical import canonicalize
from ..core.digest import digest_canonical_value, verify_digest
from .keys import sign_bytes, verify_bytes

_DSSE_PAE_PREFIX = "DSSEv1"

EVENT_PAYLOAD_TYPE = "application/vnd.act.event+json"
RECEIPT_PAYLOAD_TYPE = "application/vnd.act.receipt+json"


def pre_auth_encode(payload_type: str, payload_bytes: bytes) -> bytes:
    """DSSE PreAuthenticationEncoding, per
    https://github.com/secure-systems-lab/dsse/blob/master/protocol.md:
    PAE(type, body) = "DSSEv1" + SP + LEN(type) + SP + type + SP + LEN(body) + SP + body
    """
    type_bytes = payload_type.encode("utf-8")
    header = f"{_DSSE_PAE_PREFIX} {len(type_bytes)} {payload_type} {len(payload_bytes)} ".encode()
    return header + payload_bytes


@dataclass(frozen=True)
class EnvelopeSignature:
    key_id: str
    algorithm: str
    signature: str


@dataclass(frozen=True)
class SignedEnvelope:
    payload_type: str
    payload: dict[str, Any]
    payload_digest: str
    signatures: list[EnvelopeSignature] = field(default_factory=list)

    def to_wire_dict(self) -> dict[str, Any]:
        """Serializes to the wire shape `schemas/envelope/signed-envelope.schema.json`
        expects: camelCase envelope keys, snake_case signature fields."""
        return {
            "payloadType": self.payload_type,
            "payload": self.payload,
            "payloadDigest": self.payload_digest,
            "signatures": [
                {"key_id": sig.key_id, "algorithm": sig.algorithm, "signature": sig.signature}
                for sig in self.signatures
            ],
        }


@dataclass(frozen=True)
class Signer:
    key_id: str
    public_key: str
    private_key: str


def sign_envelope(
    payload: dict[str, Any],
    signers: list[Signer],
    payload_type: str = EVENT_PAYLOAD_TYPE,
) -> SignedEnvelope:
    """Builds a signed DSSE-compatible envelope around an unsigned payload
    (typically an ACT unsigned event). The payload digest (the event_id) is
    SHA-256 over the RFC 8785 canonical payload bytes; the signature itself
    covers the DSSE PAE construction over those same canonical bytes, per
    ACT-1.0.md section 4.2.
    """
    canonical_bytes = canonicalize(payload).encode("utf-8")
    payload_digest = digest_canonical_value(payload)
    pae = pre_auth_encode(payload_type, canonical_bytes)
    signatures = [
        EnvelopeSignature(
            key_id=signer.key_id,
            algorithm="ed25519",
            signature=sign_bytes(signer.private_key, pae),
        )
        for signer in signers
    ]
    return SignedEnvelope(
        payload_type=payload_type,
        payload=payload,
        payload_digest=payload_digest,
        signatures=signatures,
    )


@dataclass(frozen=True)
class SignatureVerificationResult:
    key_id: str
    valid: bool


@dataclass(frozen=True)
class EnvelopeVerificationResult:
    digest_valid: bool
    signatures: list[SignatureVerificationResult]


def verify_envelope(
    envelope: SignedEnvelope, public_keys: dict[str, str]
) -> EnvelopeVerificationResult:
    """Verifies an envelope's digest and every attached signature independently.

    `public_keys` maps key_id -> base64 public key for every signer whose
    signature should be checked; a signature whose key_id is not in the map
    is reported as invalid (unknown key), never silently skipped.
    """
    digest_valid = _verify_digest_safely(envelope.payload, envelope.payload_digest)
    canonical_bytes = canonicalize(envelope.payload).encode("utf-8")
    pae = pre_auth_encode(envelope.payload_type, canonical_bytes)
    signatures = []
    for sig in envelope.signatures:
        public_key = public_keys.get(sig.key_id)
        if not public_key:
            signatures.append(SignatureVerificationResult(key_id=sig.key_id, valid=False))
            continue
        signatures.append(
            SignatureVerificationResult(
                key_id=sig.key_id, valid=verify_bytes(public_key, pae, sig.signature)
            )
        )
    return EnvelopeVerificationResult(digest_valid=digest_valid, signatures=signatures)


def _verify_digest_safely(payload: Any, claimed_digest: str) -> bool:
    try:
        return verify_digest(payload, claimed_digest)
    except Exception:
        return False
