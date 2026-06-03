"""ReplayClient against mocked HTTP transport."""

import httpx

from durabl.client import ReplayClient


def test_replay_client_health_and_replay() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/health":
            return httpx.Response(200, json={"ok": True, "live": True})
        if request.url.path == "/api/replay":
            run_id = request.url.params.get("runId")
            return httpx.Response(
                200,
                json={"runId": run_id, "steps": [], "trajectory": "main"},
            )
        return httpx.Response(404, json={"error": "not found"})

    transport = httpx.MockTransport(handler)
    with ReplayClient(
        base_url="http://test",
        client=httpx.Client(transport=transport, base_url="http://test"),
    ) as c:
        assert c.health()["ok"] is True
        replay = c.get_replay("run-1")
        assert replay["runId"] == "run-1"
