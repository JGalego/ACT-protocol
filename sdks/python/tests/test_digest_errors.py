import pytest

from act_sdk.core.digest import (
    InvalidDigestError,
    digest_bytes,
    is_valid_digest_form,
    parse_digest,
    verify_digest,
)


def test_digest_bytes_rejects_an_unregistered_algorithm():
    with pytest.raises(InvalidDigestError):
        digest_bytes(b"x", algorithm="md5")


def test_parse_digest_rejects_malformed_input():
    with pytest.raises(InvalidDigestError):
        parse_digest("not-a-digest")


def test_is_valid_digest_form():
    assert is_valid_digest_form("sha-256:" + "0" * 64) is True
    assert is_valid_digest_form("sha-256:short") is False


def test_verify_digest_rejects_a_wrong_digest():
    assert verify_digest({"a": 1}, "sha-256:" + "0" * 64) is False
