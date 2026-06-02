
# durabl replay backend (`src/server.ts`)

Lightweight **node:http** server (no framework, no extra runtime deps for the UI process). Serves static `web/` and JSON replay APIs over a `JournalSource` (live SQLite journal or imported JSONL export).

## Modes

| Mode | `JournalSource.origin` | HITL `POST /api/hitl/input` | WebSocket `/api/ws/runs` |
|------|------------------------|----------------------------|---------------------------|
| **Live** | `live-sqlite-journal` | Enabled (Restate ingress) | Optional (`DURABL_ENABLE_WS=1`) |
| **Offline import** | `imported:…` | 503 — list paused only | 503 — use HTTP APIs |

Bind: `127.0.0.1` by default (`DURABL_UI_HOST`, `DURABL_UI_PORT` default `7878`).

## HTTP API (summary)

- `GET /api/health` — `live`, `hitlSubmitEnabled`, `wsEnabled`, `wsPath`
- `GET /api/runs`, `/api/replay`, `/api/state-at`, `/api/tree`, `/api/diff`
- `GET /api/hitl/paused`, `/api/hitl/status`
- `POST /api/hitl/input` — live only

## WebSocket — live step stream (optional)

**Status:** implemented (minimal v1), feature-flagged.

### Enable

```bash
export DURABL_ENABLE_WS=1
export DURABL_WS_POLL_MS=500   # optional, 100–10000
durabl ui
```

Default: `DURABL_ENABLE_WS` unset → upgrade to `/api/ws/runs` returns **404** `WebSocket disabled`.

### Endpoint

```
GET /api/ws/runs?runId=<runId>   (Upgrade: websocket)
```

- Live mode only (offline import → **503**).
- One `runId` per connection (required query param).
- Server → client UTF-8 JSON text frames only.
- Polls `JournalSource.trajectory(runId)` every `DURABL_WS_POLL_MS` (no SQLite WAL hook in v1).

### Events

| `type` | When |
|--------|------|
| `hello` | After handshake (`runId`, `steps`, `hitlState`, `pollMs`) |
| `step` | New journal entry with `seq` greater than last seen on this socket |
| `hitl_state` | Journal-derived HITL state changed (`none` \| `paused` \| `resumed`) |

`step` payload includes: `runId`, `seq`, `stepName`, `kind`, `sideEffect`, `recordedAt`, `output`.

Load historical steps with `GET /api/replay` once; use the socket for deltas.

### Client sketch

```javascript
const ws = new WebSocket(
  `ws://127.0.0.1:7878/api/ws/runs?runId=${encodeURIComponent(runId)}`,
);
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.type === "step") onStep(msg);
  if (msg.type === "hitl_state") onHitl(msg.state);
};
```

HITL resume remains `POST /api/hitl/input` (not over WS).

### Security

- No auth in v1; same trust boundary as replay HTTP. Keep localhost bind unless you intend to expose the journal.
- Step `output` may contain model/tool payloads — do not log full frames to shared telemetry.

### Deferred

| Item | Notes |
|------|--------|
| Multi-run multiplex | One connection per `runId` |
| SQLite push feed | Polling sufficient for local UI v1 |
| Client → server commands | Out of scope |
| WSS + tokens | M6 control plane |

## Modules

| File | Role |
|------|------|
| `src/server.ts` | HTTP router, static files, `upgrade` hook |
| `src/ws-runs.ts` | `/api/ws/runs` subscription |
| `src/ws-frame.ts` | RFC 6455 handshake + server text frames |
| `src/journal-source.ts` | Substrate-neutral read API |
| `src/hitl-source.ts` | Paused state + ingress resume |

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `DURABL_UI_HOST` | `127.0.0.1` | Bind address |
| `DURABL_UI_PORT` | `7878` | HTTP + WS port |
| `DURABL_ENABLE_WS` | off | `1` enables `/api/ws/runs` in live mode |
| `DURABL_WS_POLL_MS` | `500` | WS journal poll interval (ms) |
| `DURABL_JOURNAL_DB` | under `DURABL_DATA_DIR` | Live journal SQLite |
| `DURABL_RESTATE_INGRESS` | `http://localhost:8080` | HITL resume |
