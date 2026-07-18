import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from act_sdk.client import ActApiError, ActClient
from act_sdk.crypto import EnvelopeSignature, SignedEnvelope


class _Handler(BaseHTTPRequestHandler):
    # Class-level state shared across requests within one test server instance.
    request_log = []
    fail_first_n_with_500 = 0
    always_fail_with_status = None

    def log_message(self, *args):  # silence default stderr logging
        pass

    def _write_json(self, status: int, body: dict) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        _Handler.request_log.append(("GET", self.path, self.headers))
        if self.path.startswith("/v1/artifacts/missing"):
            self._write_json(
                404,
                {
                    "type": "about:blank",
                    "title": "Not Found",
                    "status": 404,
                    "code": "not_found",
                },
            )
            return
        if self.path.startswith("/v1/events"):
            self._write_json(200, {"items": [], "nextCursor": None})
            return
        self._write_json(200, {"ok": True, "path": self.path})

    def do_POST(self):
        length = int(self.headers.get("content-length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        _Handler.request_log.append(("POST", self.path, self.headers, body))

        if _Handler.always_fail_with_status is not None:
            self._write_json(
                _Handler.always_fail_with_status,
                {
                    "type": "about:blank",
                    "title": "error",
                    "status": _Handler.always_fail_with_status,
                },
            )
            return

        if _Handler.fail_first_n_with_500 > 0:
            _Handler.fail_first_n_with_500 -= 1
            self._write_json(
                500, {"type": "about:blank", "title": "transient error", "status": 500}
            )
            return

        self._write_json(201, {"accepted": True, "echo": body})


@pytest.fixture()
def server():
    _Handler.request_log = []
    _Handler.fail_first_n_with_500 = 0
    _Handler.always_fail_with_status = None
    httpd = HTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{httpd.server_port}"
    finally:
        httpd.shutdown()
        thread.join()


def _sample_envelope() -> SignedEnvelope:
    return SignedEnvelope(
        payload_type="application/vnd.act.event+json",
        payload={"event_type": "genesis"},
        payload_digest="sha-256:" + "0" * 64,
        signatures=[EnvelopeSignature(key_id="ed25519:abc", algorithm="ed25519", signature="sig")],
    )


def test_get_health(server):
    client = ActClient(server)
    result = client.health()
    assert result == {"ok": True, "path": "/v1/health/live"}


def test_bearer_token_and_idempotency_key_are_sent_as_headers(server):
    client = ActClient(server, bearer_token="actor-1")
    client.submit_intent(_sample_envelope(), idempotency_key="idem-1")
    method, path, headers, body = _Handler.request_log[-1]
    assert method == "POST"
    assert path == "/v1/intents"
    assert headers["authorization"] == "Bearer actor-1"
    assert headers["idempotency-key"] == "idem-1"
    assert body["payloadType"] == "application/vnd.act.event+json"
    assert body["signatures"][0]["key_id"] == "ed25519:abc"


def test_get_with_query_params(server):
    client = ActClient(server)
    client.list_events(cursor="42", limit=10)
    _, path, _ = _Handler.request_log[-1]
    assert path.startswith("/v1/events?")
    assert "cursor=42" in path
    assert "limit=10" in path


def test_raises_act_api_error_with_problem_details_on_404(server):
    client = ActClient(server)
    with pytest.raises(ActApiError) as exc_info:
        client.get_artifact("missing-one")
    assert exc_info.value.status == 404
    assert exc_info.value.problem["code"] == "not_found"


def test_retries_on_5xx_then_succeeds(server):
    _Handler.fail_first_n_with_500 = 2
    client = ActClient(server, max_retries=3, retry_delay_seconds=0.01)
    result = client.submit_intent(_sample_envelope())
    assert result["accepted"] is True
    post_requests = [entry for entry in _Handler.request_log if entry[0] == "POST"]
    assert len(post_requests) == 3


def test_gives_up_after_max_retries_on_persistent_5xx(server):
    _Handler.always_fail_with_status = 503
    client = ActClient(server, max_retries=1, retry_delay_seconds=0.01)
    with pytest.raises(ActApiError) as exc_info:
        client.submit_intent(_sample_envelope())
    assert exc_info.value.status == 503


def test_every_write_method_posts_to_its_documented_path(server):
    client = ActClient(server)
    envelope = _sample_envelope()
    cases = [
        (client.submit_intent, "/v1/intents"),
        (client.submit_transformation, "/v1/transformations"),
        (client.submit_artifact, "/v1/artifacts"),
        (client.submit_approval_request, "/v1/approval-requests"),
        (client.submit_approval_decision, "/v1/approval-decisions"),
        (client.submit_challenge, "/v1/challenges"),
        (client.submit_verification, "/v1/verifications"),
        (client.register_actor, "/v1/actors"),
        (client.register_key, "/v1/keys"),
        (client.publish_policy, "/v1/policies"),
    ]
    for method, expected_path in cases:
        method(envelope)
        _, path, _, _ = _Handler.request_log[-1]
        assert path == expected_path


def test_every_read_method_gets_its_documented_path(server):
    client = ActClient(server)
    cases = [
        (lambda: client.get_artifact("artifact-1"), "/v1/artifacts/artifact-1"),
        (
            lambda: client.get_artifact_versions("artifact-1"),
            "/v1/artifacts/artifact-1/versions",
        ),
        (lambda: client.get_lineage("artifact-1"), "/v1/lineage/artifact-1"),
        (
            lambda: client.get_lineage("artifact-1", max_depth=3),
            "/v1/lineage/artifact-1?maxDepth=3",
        ),
        (lambda: client.get_history("artifact-1"), "/v1/history/artifact-1"),
    ]
    for call, expected_path in cases:
        call()
        _, path, _ = _Handler.request_log[-1]
        assert path == expected_path


def test_export_and_import_bundle(server):
    client = ActClient(server)
    client.export_bundle(["artifact-1"])
    method, path, _, body = _Handler.request_log[-1]
    assert path == "/v1/bundles/export"
    assert body == {"artifactIds": ["artifact-1"]}

    client.import_bundle({"events": []})
    _, path2, _, body2 = _Handler.request_log[-1]
    assert path2 == "/v1/bundles/import"
    assert body2 == {"events": []}
