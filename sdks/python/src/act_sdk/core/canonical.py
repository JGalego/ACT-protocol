"""RFC 8785 (JSON Canonicalization Scheme, JCS) serialization.

Ports `packages/core/src/canonical.ts` byte-for-byte: this is intentionally
not delegated to a third-party canonicalizer, for the same reason as the
TypeScript implementation -- this is security-critical code (every ACT
digest and signature is computed over this output) small enough to audit
directly.

Two details make a naive ``json.dumps`` insufficient:

* **Number formatting.** JSON.stringify's number formatting is ECMA-262's
  ``Number::toString`` (shortest round-tripping decimal digits, with its own
  fixed/exponential-notation thresholds), which differs from Python's
  ``repr(float)`` formatting rules. ``_js_number_to_string`` reuses
  ``repr()`` only to obtain the shortest round-tripping *digit string*
  (via ``decimal.Decimal``, stripping the trailing zeros ``repr`` pads on
  for fixed-notation display), then re-formats those digits per the exact
  ECMA-262 algorithm.
* **Key ordering.** RFC 8785 section 3.2.3 requires object keys sorted by
  UTF-16 code unit sequence (ECMAScript's default string ``<``), which is
  not the same as Python's code-point ordering for keys containing
  characters outside the Basic Multilingual Plane.
"""

from __future__ import annotations

import json
import math
import struct
from decimal import Decimal
from typing import Any


class CanonicalizationError(Exception):
    pass


class _Undefined:
    """Sentinel mirroring JavaScript's `undefined`: dropped from objects,
    becomes `null` inside arrays. Python has no native equivalent -- use
    this only when porting a case that genuinely needs that JS semantic."""

    def __repr__(self) -> str:
        return "UNDEFINED"


UNDEFINED = _Undefined()


def canonicalize(value: Any) -> str:
    _assert_canonicalizable(value)
    return _serialize(value)


def canonicalize_to_bytes(value: Any) -> bytes:
    return canonicalize(value).encode("utf-8")


def _serialize(value: Any) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return _format_string(value)
    if isinstance(value, (int, float)):
        return _format_number(value)
    if isinstance(value, (list, tuple)):
        items = ("null" if item is UNDEFINED else _serialize(item) for item in value)
        return "[" + ",".join(items) + "]"
    if isinstance(value, dict):
        keys = [k for k in value.keys() if value[k] is not UNDEFINED]
        keys.sort(key=_utf16_sort_key)
        members = (f"{_format_string(k)}:{_serialize(value[k])}" for k in keys)
        return "{" + ",".join(members) + "}"
    raise CanonicalizationError(f"Non-serializable type at runtime: {type(value)!r}")


def _assert_canonicalizable(value: Any, path: str = "$") -> None:
    if value is UNDEFINED:
        raise CanonicalizationError(
            f"Undefined value at {path} is not representable in canonical JSON"
        )
    if value is None or isinstance(value, (bool, str)):
        return
    if isinstance(value, (int, float)):
        if isinstance(value, float) and not math.isfinite(value):
            raise CanonicalizationError(
                f"Non-finite number at {path} is not representable in canonical JSON"
            )
        return
    if isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            _assert_canonicalizable(item, f"{path}[{index}]")
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if item is UNDEFINED:
                continue
            _assert_canonicalizable(item, f"{path}.{key}")
        return
    raise CanonicalizationError(f"Non-serializable type at {path}: {type(value)!r}")


def _format_string(s: str) -> str:
    # json.dumps with ensure_ascii=False matches JSON.stringify's string
    # escaping exactly: quote, backslash, and control characters are
    # escaped; every other character (including non-ASCII) is emitted raw.
    return json.dumps(s, ensure_ascii=False)


def _utf16_sort_key(s: str) -> tuple[int, ...]:
    encoded = s.encode("utf-16-be", "surrogatepass")
    return struct.unpack(f">{len(encoded) // 2}H", encoded)


def _format_number(value: Any) -> str:
    if isinstance(value, bool):  # pragma: no cover -- guarded by _serialize's ordering
        raise CanonicalizationError("bool is not a JCS number")
    try:
        as_float = float(value)
    except OverflowError as err:
        raise CanonicalizationError(
            f"Number {value!r} is not representable as a finite value"
        ) from err
    if not math.isfinite(as_float):
        raise CanonicalizationError(
            f"Non-finite number {value!r} is not representable in canonical JSON"
        )
    return _js_number_to_string(as_float)


def _js_number_to_string(x: float) -> str:
    """Reproduces ECMA-262 Number::toString for a finite double."""
    if x == 0:
        return "0"
    sign = "-" if math.copysign(1.0, x) < 0 else ""
    digits, n = _shortest_round_trip_digits(abs(x))
    k = len(digits)
    if k <= n <= 21:
        return sign + digits + ("0" * (n - k))
    if 0 < n <= 21:
        return sign + digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return sign + "0." + ("0" * -n) + digits
    mantissa = digits if k == 1 else f"{digits[0]}.{digits[1:]}"
    exponent = n - 1
    exponent_sign = "+" if exponent >= 0 else "-"
    return f"{sign}{mantissa}e{exponent_sign}{abs(exponent)}"


def _shortest_round_trip_digits(x: float) -> tuple[str, int]:
    """Returns (digits, n) with no leading/trailing zeros in `digits`
    (except the value 0 itself, handled by the caller) such that
    x == int(digits) * 10 ** (n - len(digits)) -- i.e. the same (s, n, k)
    triple ECMA-262's Number::toString algorithm is defined in terms of.

    `repr(x)` already computes the shortest decimal digit string that
    round-trips to `x` (CPython uses David Gay's dtoa, mode 0); parsing it
    with `Decimal` recovers those digits exactly, and trailing zeros
    `repr` may have padded on for fixed-notation display are stripped
    (adjusting the exponent to compensate) to reach the true minimal `k`.
    """
    _, digit_tuple, exponent = Decimal(repr(x)).as_tuple()
    assert isinstance(exponent, int)  # x is always finite here; never 'n'/'N'/'F' (NaN/Infinity)
    digits: list[int] = list(digit_tuple)
    while len(digits) > 1 and digits[-1] == 0:
        digits.pop()
        exponent += 1
    k = len(digits)
    n = exponent + k
    return "".join(str(d) for d in digits), n
