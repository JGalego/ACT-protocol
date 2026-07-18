"""Ports `packages/crypto/src/key-lifecycle.ts`.

Pure (no storage): the ledger persists Key Status Change events;
verification code combines this evaluation with ledger-recorded history to
decide whether a given signature was made while its key was in good
standing.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

KeyStatus = str  # one of: issued, active, rotated, expired, revoked, compromised

_TRUSTED_SIGNING_STATUSES = frozenset({"issued", "active"})
_DEFAULT_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000


@dataclass(frozen=True)
class KeyStatusEvent:
    status: KeyStatus
    effective_at: str  # ISO 8601 timestamp


@dataclass(frozen=True)
class KeyValidityResult:
    status_at_time: KeyStatus
    valid_for_signing: bool
    reason: str


def _parse_iso_ms(iso: str) -> float:
    normalized = iso[:-1] + "+00:00" if iso.endswith("Z") else iso
    dt = datetime.fromisoformat(normalized)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp() * 1000


def evaluate_key_validity_at(
    history: list[KeyStatusEvent],
    query_time_iso: str,
    compromise_grace_period_ms: int | None = None,
) -> KeyValidityResult:
    """Evaluates a key's status as of a given time from its ordered history
    of status-change events, and whether a signature made at that time
    should be trusted. `compromised` retroactively invalidates signatures
    within the grace period before the compromise was recorded;
    `expired`/`rotated`/`revoked` do not retroactively invalidate
    signatures made while the key was still active.
    """
    if not history:
        return KeyValidityResult(
            status_at_time="issued",
            valid_for_signing=False,
            reason="no key history recorded",
        )

    query_time = _parse_iso_ms(query_time_iso)
    sorted_history = sorted(history, key=lambda e: _parse_iso_ms(e.effective_at))

    compromise_event = next((e for e in sorted_history if e.status == "compromised"), None)
    if compromise_event is not None:
        grace_ms = (
            _DEFAULT_GRACE_PERIOD_MS
            if compromise_grace_period_ms is None
            else compromise_grace_period_ms
        )
        compromise_recorded_at = _parse_iso_ms(compromise_event.effective_at)
        if query_time >= compromise_recorded_at - grace_ms:
            return KeyValidityResult(
                status_at_time="compromised",
                valid_for_signing=False,
                reason=(
                    f"key flagged compromised at {compromise_event.effective_at}; "
                    f"signature falls within the {grace_ms}ms retroactive grace window"
                ),
            )

    current = sorted_history[0]
    for event in sorted_history:
        if _parse_iso_ms(event.effective_at) > query_time:
            break
        current = event

    valid_for_signing = current.status in _TRUSTED_SIGNING_STATUSES
    reason = (
        f"key was '{current.status}' at {query_time_iso}"
        if valid_for_signing
        else f"key was '{current.status}' (not issued/active) at {query_time_iso}"
    )
    return KeyValidityResult(
        status_at_time=current.status, valid_for_signing=valid_for_signing, reason=reason
    )
