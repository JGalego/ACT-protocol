"""Ports `packages/sdk-typescript/src/client.ts`.

Uses only `urllib.request` from the standard library -- no extra runtime
dependency, matching this SDK's minimal-dependency philosophy (`cryptography`
is the sole exception, since Ed25519 has no stdlib implementation).
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from .crypto.dsse import SignedEnvelope


class ActApiError(Exception):
    """An RFC 9457 Problem Details error response, raised by ActClient."""

    def __init__(self, message: str, status: int, problem: dict[str, Any]) -> None:
        super().__init__(message)
        self.status = status
        self.problem = problem


class ActClient:
    """A thin, retrying HTTP client for the ACT reference API. Every write
    method takes an already-signed envelope built with `act_sdk.crypto` --
    this client never signs on the caller's behalf, preserving
    non-repudiation."""

    def __init__(
        self,
        base_url: str,
        bearer_token: str | None = None,
        max_retries: int = 2,
        retry_delay_seconds: float = 0.2,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._bearer_token = bearer_token
        self._max_retries = max_retries
        self._retry_delay_seconds = retry_delay_seconds

    def submit_intent(self, envelope: SignedEnvelope, idempotency_key: str | None = None) -> Any:
        return self._post("/v1/intents", envelope.to_wire_dict(), idempotency_key)

    def submit_transformation(
        self, envelope: SignedEnvelope, idempotency_key: str | None = None
    ) -> Any:
        return self._post("/v1/transformations", envelope.to_wire_dict(), idempotency_key)

    def submit_artifact(self, envelope: SignedEnvelope, idempotency_key: str | None = None) -> Any:
        return self._post("/v1/artifacts", envelope.to_wire_dict(), idempotency_key)

    def submit_approval_request(
        self, envelope: SignedEnvelope, idempotency_key: str | None = None
    ) -> Any:
        return self._post("/v1/approval-requests", envelope.to_wire_dict(), idempotency_key)

    def submit_approval_decision(
        self, envelope: SignedEnvelope, idempotency_key: str | None = None
    ) -> Any:
        return self._post("/v1/approval-decisions", envelope.to_wire_dict(), idempotency_key)

    def submit_challenge(self, envelope: SignedEnvelope, idempotency_key: str | None = None) -> Any:
        return self._post("/v1/challenges", envelope.to_wire_dict(), idempotency_key)

    def submit_verification(
        self, envelope: SignedEnvelope, idempotency_key: str | None = None
    ) -> Any:
        return self._post("/v1/verifications", envelope.to_wire_dict(), idempotency_key)

    def register_actor(self, envelope: SignedEnvelope, idempotency_key: str | None = None) -> Any:
        return self._post("/v1/actors", envelope.to_wire_dict(), idempotency_key)

    def register_key(self, envelope: SignedEnvelope, idempotency_key: str | None = None) -> Any:
        return self._post("/v1/keys", envelope.to_wire_dict(), idempotency_key)

    def publish_policy(self, envelope: SignedEnvelope, idempotency_key: str | None = None) -> Any:
        return self._post("/v1/policies", envelope.to_wire_dict(), idempotency_key)

    def get_artifact(self, artifact_id: str) -> Any:
        return self._get(f"/v1/artifacts/{urllib.parse.quote(artifact_id, safe='')}")

    def get_artifact_versions(self, artifact_id: str) -> Any:
        return self._get(f"/v1/artifacts/{urllib.parse.quote(artifact_id, safe='')}/versions")

    def get_lineage(self, id_: str, max_depth: int | None = None) -> Any:
        query = {"maxDepth": str(max_depth)} if max_depth else None
        return self._get(f"/v1/lineage/{urllib.parse.quote(id_, safe='')}", query)

    def get_history(self, id_: str) -> Any:
        return self._get(f"/v1/history/{urllib.parse.quote(id_, safe='')}")

    def list_events(self, cursor: str | None = None, limit: int = 50) -> Any:
        query = {"limit": str(limit)}
        if cursor:
            query["cursor"] = cursor
        return self._get("/v1/events", query)

    def health(self) -> Any:
        return self._get("/v1/health/live")

    def export_bundle(self, scope_artifact_ids: list[str] | None = None) -> Any:
        return self._post("/v1/bundles/export", {"artifactIds": scope_artifact_ids or []})

    def import_bundle(self, bundle: dict[str, Any]) -> Any:
        return self._post("/v1/bundles/import", bundle)

    def _post(self, path: str, body: Any, idempotency_key: str | None = None) -> Any:
        return self._request("POST", path, body, idempotency_key)

    def _get(self, path: str, query: dict[str, str] | None = None) -> Any:
        qs = f"?{urllib.parse.urlencode(query)}" if query else ""
        return self._request("GET", f"{path}{qs}")

    def _request(
        self,
        method: str,
        path: str,
        body: Any | None = None,
        idempotency_key: str | None = None,
    ) -> Any:
        headers = {"content-type": "application/json"}
        if self._bearer_token:
            headers["authorization"] = f"Bearer {self._bearer_token}"
        if idempotency_key:
            headers["idempotency-key"] = idempotency_key

        data = json.dumps(body).encode("utf-8") if body is not None else None
        url = f"{self._base_url}{path}"

        last_error: Exception | None = None
        for attempt in range(self._max_retries + 1):
            request = urllib.request.Request(url, data=data, headers=headers, method=method)
            try:
                with urllib.request.urlopen(request) as response:
                    return self._read_success(response.status, response)
            except urllib.error.HTTPError as err:
                if err.code >= 500 and attempt < self._max_retries:
                    last_error = err
                    time.sleep(self._retry_delay_seconds * (2**attempt))
                    continue
                problem = self._safe_problem_json(err)
                raise ActApiError(
                    problem.get("title", f"HTTP {err.code}"), err.code, problem
                ) from err
            except urllib.error.URLError as err:
                last_error = err
                if attempt < self._max_retries:
                    time.sleep(self._retry_delay_seconds * (2**attempt))
                    continue
        raise last_error if last_error else RuntimeError("ActClient request failed")

    @staticmethod
    def _read_success(status: int, response: Any) -> Any:
        if status == 204:
            return None
        raw = response.read()
        return json.loads(raw) if raw else None

    @staticmethod
    def _safe_problem_json(err: urllib.error.HTTPError) -> dict[str, Any]:
        try:
            return json.loads(err.read())
        except Exception:
            return {"type": "about:blank", "title": f"HTTP {err.code}", "status": err.code}
