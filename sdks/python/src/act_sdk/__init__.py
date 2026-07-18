"""ACT Python SDK: ergonomic client for constructing, signing, and submitting ACT events.

Mirrors `@act/sdk` (TypeScript) at the same abstraction level: canonicalization
and digests (`act_sdk.core`), Ed25519/DSSE (`act_sdk.crypto`), an unsigned
event builder (`act_sdk.event_builder`), and a thin retrying HTTP client
(`act_sdk.client`).
"""

from .client import ActApiError, ActClient
from .event_builder import build_unsigned_event, new_artifact_id

__all__ = [
    "ActApiError",
    "ActClient",
    "build_unsigned_event",
    "new_artifact_id",
]
