"""Ports `packages/core/src/ids.ts`.

CPython 3.13 has no `uuid.uuid7()` (landed in 3.14), so `generate_id`
builds a UUIDv7 directly per RFC 9562 section 5.7: a 48-bit big-endian
Unix-epoch-millisecond timestamp, the 4-bit version, 12 random bits, the
2-bit RFC 4122 variant, then 62 more random bits.
"""

from __future__ import annotations

import os
import re
import time
import uuid as _uuid

_UUID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def generate_id() -> str:
    """Generates a new logical identifier (UUIDv7, time-ordered) per ACT-1.0.md section 3."""
    unix_ts_ms = int(time.time() * 1000) & 0xFFFFFFFFFFFF
    rand_a = int.from_bytes(os.urandom(2), "big") & 0x0FFF
    rand_b = int.from_bytes(os.urandom(8), "big") & 0x3FFFFFFFFFFFFFFF
    value = unix_ts_ms << 80
    value |= 0x7 << 76
    value |= rand_a << 64
    value |= 0x2 << 62
    value |= rand_b
    return str(_uuid.UUID(int=value))


def is_valid_id(id_str: str) -> bool:
    return bool(_UUID_PATTERN.match(id_str))


def is_freshly_generated_id(id_str: str) -> bool:
    """True only for UUIDv7 identifiers, the required form for newly generated ACT identities."""
    return is_valid_id(id_str) and id_str[14] == "7"
