"""HTTP client for the durabl replay UI API — mirrors ``docs/API.md``."""

from __future__ import annotations

import os
from typing import Any

import httpx


class ReplayClient:
    """Read-only client for ``GET /api/*`` endpoints on the replay web server."""

    def __init__(
        self,
        base_url: str | None = None,
        *,
        timeout: float = 30.0,
        client: httpx.Client | None = None,
    ) -> None:
        host = os.environ.get("DURABL_UI_HOST", "127.0.0.1")
        port = os.environ.get("DURABL_UI_PORT", "7878")
        self._base_url = (base_url or f"http://{host}:{port}").rstrip("/")
        self._owns_client = client is None
        self._client = client or httpx.Client(base_url=self._base_url, timeout=timeout)

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> ReplayClient:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def _get(self, path: str, params: dict[str, str | int] | None = None) -> Any:
        r = self._client.get(path, params=params)
        r.raise_for_status()
        return r.json()

    def health(self) -> dict[str, Any]:
        """``GET /api/health``."""
        return self._get("/api/health")

    def list_runs(self) -> dict[str, Any]:
        """``GET /api/runs``."""
        return self._get("/api/runs")

    def get_replay(self, run_id: str) -> dict[str, Any]:
        """``GET /api/replay?runId=``."""
        return self._get("/api/replay", params={"runId": run_id})

    def get_state_at(self, run_id: str, n: int) -> dict[str, Any]:
        """``GET /api/state-at?runId=&n=``."""
        return self._get("/api/state-at", params={"runId": run_id, "n": n})

    def get_tree(self, run_id: str) -> dict[str, Any]:
        """``GET /api/tree?runId=``."""
        return self._get("/api/tree", params={"runId": run_id})

    def get_diff(self, run_a: str, run_b: str) -> dict[str, Any]:
        """``GET /api/diff?a=&b=``."""
        return self._get("/api/diff", params={"a": run_a, "b": run_b})
