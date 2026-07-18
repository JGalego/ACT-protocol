from act_sdk.core import generate_id, is_freshly_generated_id, is_valid_id
from act_sdk.core.ids import is_valid_id as is_valid_id_direct


def _timestamp_prefix(id_: str) -> int:
    # First 48 bits (12 hex chars, ignoring the hyphen) are the
    # millisecond timestamp per RFC 9562 section 5.7.
    return int(id_[:8] + id_[9:13], 16)


def test_generate_id_produces_a_valid_freshly_generated_uuidv7():
    id_ = generate_id()
    assert is_valid_id(id_) is True
    assert is_freshly_generated_id(id_) is True


def test_generate_id_is_time_ordered():
    timestamps = [_timestamp_prefix(generate_id()) for _ in range(20)]
    assert timestamps == sorted(timestamps)


def test_generate_id_produces_unique_values():
    ids = {generate_id() for _ in range(50)}
    assert len(ids) == 50


def test_is_valid_id_direct_import_matches_reexport():
    id_ = generate_id()
    assert is_valid_id_direct(id_) == is_valid_id(id_)
