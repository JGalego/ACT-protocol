"""Ports `packages/sdk-typescript/src/event-builder.ts`."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .core.ids import generate_id


def build_unsigned_event(
    event_type: str,
    actor_id: str,
    actor_key_id: str,
    tenant: str | dict[str, Any],
    subject: dict[str, Any],
    payload: dict[str, Any],
    causal_parents: list[dict[str, Any]] | None = None,
    content_descriptors: list[dict[str, Any]] | None = None,
    policy_context: dict[str, Any] | None = None,
    extensions: dict[str, Any] | None = None,
    occurred_at: str | None = None,
) -> dict[str, Any]:
    """Builds an unsigned ACT event payload with protocol defaults filled
    in. Pass to `act_sdk.crypto.sign_envelope` to produce a submittable
    envelope."""
    return {
        "protocol_version": "act/1.0",
        "event_type": event_type,
        "occurred_at": occurred_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "actor": {"actor_id": actor_id, "key_id": actor_key_id},
        "tenant": tenant,
        "subject": subject,
        "causal_parents": causal_parents or [],
        "content_descriptors": content_descriptors or [],
        "policy_context": policy_context
        or {"not_applicable": True, "reason": "no policy configured"},
        "payload": payload,
        "extensions": extensions or {},
    }


def new_artifact_id() -> str:
    """Generates a fresh logical artifact id (UUIDv7)."""
    return generate_id()
