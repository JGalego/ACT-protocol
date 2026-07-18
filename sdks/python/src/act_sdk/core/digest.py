"""Ports `packages/core/src/digest.ts`."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Any

from .canonical import canonicalize

DigestAlgorithm = str  # only 'sha-256' is registered today

_DIGEST_PATTERN = re.compile(r"^(sha-256):([0-9a-f]{64})$")


def digest_bytes(data: bytes | str, algorithm: DigestAlgorithm = "sha-256") -> str:
    """Computes an ACT digest string ("algorithm:hex") over raw bytes."""
    if algorithm != "sha-256":
        raise InvalidDigestError(algorithm)
    raw = data.encode("utf-8") if isinstance(data, str) else data
    return f"sha-256:{hashlib.sha256(raw).hexdigest()}"


def digest_canonical_value(value: Any, algorithm: DigestAlgorithm = "sha-256") -> str:
    """Computes an ACT digest over the RFC 8785 canonical bytes of a JSON value."""
    return digest_bytes(canonicalize(value), algorithm)


@dataclass(frozen=True)
class ParsedDigest:
    algorithm: DigestAlgorithm
    hex: str


def parse_digest(digest: str) -> ParsedDigest:
    match = _DIGEST_PATTERN.match(digest)
    if not match:
        raise InvalidDigestError(digest)
    return ParsedDigest(algorithm=match.group(1), hex=match.group(2))


def is_valid_digest_form(digest: str) -> bool:
    return bool(_DIGEST_PATTERN.match(digest))


def verify_digest(value: Any, claimed_digest: str) -> bool:
    parsed = parse_digest(claimed_digest)
    return digest_canonical_value(value, parsed.algorithm) == claimed_digest


class InvalidDigestError(ValueError):
    def __init__(self, digest: str) -> None:
        super().__init__(f"Invalid or unregistered digest: {digest!r}")
