from act_sdk.core import is_freshly_generated_id
from act_sdk.event_builder import build_unsigned_event, new_artifact_id


def test_new_artifact_id_is_a_fresh_uuidv7():
    assert is_freshly_generated_id(new_artifact_id()) is True


def test_build_unsigned_event_fills_in_protocol_defaults():
    event = build_unsigned_event(
        event_type="genesis",
        actor_id="actor-1",
        actor_key_id="ed25519:deadbeef",
        tenant="acme",
        subject={"kind": "artifact", "artifact_id": "artifact-1"},
        payload={"data": {"title": "hello"}},
    )
    assert event["protocol_version"] == "act/1.0"
    assert event["event_type"] == "genesis"
    assert event["actor"] == {"actor_id": "actor-1", "key_id": "ed25519:deadbeef"}
    assert event["tenant"] == "acme"
    assert event["causal_parents"] == []
    assert event["content_descriptors"] == []
    assert event["policy_context"] == {"not_applicable": True, "reason": "no policy configured"}
    assert event["extensions"] == {}
    assert event["occurred_at"].endswith("Z")


def test_build_unsigned_event_honors_explicit_overrides():
    event = build_unsigned_event(
        event_type="transformation_recorded",
        actor_id="actor-1",
        actor_key_id="ed25519:deadbeef",
        tenant={"not_applicable": True, "reason": "personal use"},
        subject={"kind": "transformation"},
        payload={"inputs": ["a"], "outputs": ["b"]},
        causal_parents=[{"event_id": "evt-1", "relation": "derived_from"}],
        content_descriptors=[{"sensitivity": "public"}],
        policy_context={"policy_id": "p1", "policy_version": "1"},
        extensions={"x": 1},
        occurred_at="2026-01-01T00:00:00Z",
    )
    assert event["tenant"] == {"not_applicable": True, "reason": "personal use"}
    assert event["causal_parents"] == [{"event_id": "evt-1", "relation": "derived_from"}]
    assert event["content_descriptors"] == [{"sensitivity": "public"}]
    assert event["policy_context"] == {"policy_id": "p1", "policy_version": "1"}
    assert event["extensions"] == {"x": 1}
    assert event["occurred_at"] == "2026-01-01T00:00:00Z"
