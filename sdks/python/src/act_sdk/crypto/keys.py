"""Ports `packages/crypto/src/keys.ts`.

Uses the `cryptography` package's Ed25519 primitives (there is no Ed25519
support in the Python standard library) -- signatures are deterministic
per RFC 8032, so a fixed keypair and message byte-for-byte match the
signature any other conformant implementation (including
`packages/crypto`) produces for the same inputs; see
`conformance/vectors/signatures.json`.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
    PublicFormat,
)

from ..core.digest import digest_bytes


@dataclass(frozen=True)
class KeyPair:
    """ACT key identifier + raw Ed25519 key material, base64-encoded."""

    key_id: str
    public_key: str
    private_key: str


def generate_key_pair() -> KeyPair:
    """Generates a fresh Ed25519 key pair."""
    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key()
    private_key_b64 = base64.b64encode(
        private_key.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())
    ).decode("ascii")
    public_key_b64 = base64.b64encode(
        public_key.public_bytes(Encoding.Raw, PublicFormat.Raw)
    ).decode("ascii")
    return KeyPair(
        key_id=key_id_for(public_key_b64),
        public_key=public_key_b64,
        private_key=private_key_b64,
    )


def key_id_for(public_key_base64: str) -> str:
    """Derives the ACT key_id ("ed25519:<hex fingerprint>") for a raw base64-encoded public key."""
    digest = digest_bytes(base64.b64decode(public_key_base64))
    return f"ed25519:{digest.split(':', 1)[1]}"


def sign_bytes(private_key_base64: str, message: bytes) -> str:
    """Signs raw bytes with an Ed25519 private key, returning a base64-encoded signature.

    Unlike the TypeScript SDK's `signBytes`, this does not also take the
    public key -- Ed25519 private key material alone determines the
    signature; the public-key parameter over there is an artifact of how
    Node's WebCrypto/JWK key import works, not a cryptographic requirement.
    """
    private_key = Ed25519PrivateKey.from_private_bytes(base64.b64decode(private_key_base64))
    signature = private_key.sign(message)
    return base64.b64encode(signature).decode("ascii")


def verify_bytes(public_key_base64: str, message: bytes, signature_base64: str) -> bool:
    """Verifies a base64-encoded Ed25519 signature over raw bytes."""
    try:
        public_key = Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key_base64))
        public_key.verify(base64.b64decode(signature_base64), message)
        return True
    except (InvalidSignature, ValueError):
        return False
