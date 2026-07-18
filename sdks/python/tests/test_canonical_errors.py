import math

import pytest

from act_sdk.core.canonical import UNDEFINED, CanonicalizationError, canonicalize


def test_rejects_top_level_undefined():
    with pytest.raises(CanonicalizationError):
        canonicalize(UNDEFINED)


def test_rejects_non_finite_number():
    with pytest.raises(CanonicalizationError):
        canonicalize({"n": math.inf})
    with pytest.raises(CanonicalizationError):
        canonicalize({"n": math.nan})


def test_rejects_an_integer_too_large_to_become_a_finite_double():
    with pytest.raises(CanonicalizationError):
        canonicalize({"n": 10**400})


def test_rejects_unsupported_type():
    with pytest.raises(CanonicalizationError):
        canonicalize({"s": {1, 2, 3}})


def test_undefined_in_array_is_rejected():
    # Matches packages/core/src/canonical.ts's actual behavior: its
    # assertCanonicalizable rejects `undefined` unconditionally, including
    # array elements, before serialize()'s undefined-to-null array handling
    # is ever reached -- only object *values* are genuinely droppable.
    with pytest.raises(CanonicalizationError):
        canonicalize([1, UNDEFINED, 3])


def test_undefined_nested_object_value_is_ok_to_omit():
    assert canonicalize({"a": {"b": UNDEFINED, "c": 1}}) == '{"a":{"c":1}}'
