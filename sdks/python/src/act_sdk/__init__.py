"""ACT Python SDK for constructing, signing, and submitting events.

Includes canonicalization and digests (`act_sdk.core`), Ed25519/DSSE
(`act_sdk.crypto`), event construction (`act_sdk.event_builder`), and a retrying
HTTP client (`act_sdk.client`), matching the TypeScript SDK's functionality.
"""

from .client import ActApiError, ActClient
from .event_builder import build_unsigned_event, new_artifact_id

__all__ = [
    "ActApiError",
    "ActClient",
    "build_unsigned_event",
    "new_artifact_id",
]
