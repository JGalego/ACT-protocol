from act_sdk.crypto import (
    Signer,
    generate_key_pair,
    sign_envelope,
    verify_bytes,
    verify_envelope,
)
from act_sdk.crypto.keys import sign_bytes


def test_generate_key_pair_round_trips_through_sign_and_verify():
    key_pair = generate_key_pair()
    message = b"round trip"
    signature = sign_bytes(key_pair.private_key, message)
    assert verify_bytes(key_pair.public_key, message, signature) is True


def test_verify_bytes_rejects_a_tampered_message():
    key_pair = generate_key_pair()
    signature = sign_bytes(key_pair.private_key, b"original")
    assert verify_bytes(key_pair.public_key, b"tampered", signature) is False


def test_verify_bytes_rejects_malformed_input_without_raising():
    key_pair = generate_key_pair()
    assert verify_bytes(key_pair.public_key, b"x", "not-base64-signature!!") is False
    assert verify_bytes("not-a-key", b"x", "AA==") is False


def test_sign_and_verify_envelope_round_trip():
    key_pair = generate_key_pair()
    signer = Signer(
        key_id=key_pair.key_id, public_key=key_pair.public_key, private_key=key_pair.private_key
    )
    payload = {"protocol_version": "act/1.0", "event_type": "genesis", "payload": {"a": 1}}
    envelope = sign_envelope(payload, [signer])

    result = verify_envelope(envelope, {key_pair.key_id: key_pair.public_key})
    assert result.digest_valid is True
    assert len(result.signatures) == 1
    assert result.signatures[0].valid is True


def test_verify_envelope_flags_unknown_key_id_without_skipping_it():
    key_pair = generate_key_pair()
    signer = Signer(
        key_id=key_pair.key_id, public_key=key_pair.public_key, private_key=key_pair.private_key
    )
    envelope = sign_envelope({"a": 1}, [signer])

    result = verify_envelope(envelope, {})
    assert result.signatures[0].valid is False


def test_verify_envelope_treats_a_malformed_payload_digest_as_invalid_not_a_crash():
    key_pair = generate_key_pair()
    signer = Signer(
        key_id=key_pair.key_id, public_key=key_pair.public_key, private_key=key_pair.private_key
    )
    envelope = sign_envelope({"a": 1}, [signer])
    malformed = envelope.__class__(
        payload_type=envelope.payload_type,
        payload=envelope.payload,
        payload_digest="not-a-well-formed-digest",
        signatures=envelope.signatures,
    )
    result = verify_envelope(malformed, {key_pair.key_id: key_pair.public_key})
    assert result.digest_valid is False


def test_verify_envelope_flags_tampered_payload_digest():
    key_pair = generate_key_pair()
    signer = Signer(
        key_id=key_pair.key_id, public_key=key_pair.public_key, private_key=key_pair.private_key
    )
    envelope = sign_envelope({"a": 1}, [signer])
    tampered = envelope.__class__(
        payload_type=envelope.payload_type,
        payload={"a": 2},
        payload_digest=envelope.payload_digest,
        signatures=envelope.signatures,
    )
    result = verify_envelope(tampered, {key_pair.key_id: key_pair.public_key})
    assert result.digest_valid is False
