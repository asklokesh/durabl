
# durabl — Backend

**Scope:** Replay UI HTTP server (`src/server.ts`), structured logging (`src/logging.ts`), and local journal access patterns.

---

## Replay UI server

`startServer` / `startServerHandle` bind a `node:http` server (no framework) that serves:

| Surface | Role |
|---|---|
| `/api/*` | Read-only replay + HITL proxy (live mode only for submit) |
| Static `web/` | Single-page replay UI |

Defaults: `127.0.0.1:7878` (`DURABL_UI_HOST`, `DURABL_UI_PORT`). Offline mode: `importPath` or pre-built `JournalSource` from a JSONL export.

### Ops (not under `/api/*`)

| Route | Response |
|---|---|
| `GET /health` | `{ "ok": true }` |
| `GET /ready` | `{ "ready": true }` offline; live checks Restate admin |
| `GET /metrics` | Prometheus text stub |

### Replay API (selected)

| Route | Notes |
|---|---|
| `GET /api/health` | Origin, `live`, `hitlSubmitEnabled`, optional WS fields |
| `GET /api/runs` | `limit`, `cursor` pagination |
| `GET /api/inspect`, `/api/lineage`, `/api/forks` | `runId` query param |
| `POST /api/fork` | Live only (Restate ingress) |
| `POST /api/hitl/input` | Live only; rate-limited |
| `GET /api/ws/runs` | WebSocket upgrade when `DURABL_ENABLE_WS=1` |

Security: `src/http-security.ts`, `src/api-auth.js`, `DURABL_API_KEY`, `DURABL_CORS_ORIGINS`. Tests: `npm run test:api`.

---

## Request logging

Structured logs go to **stderr** as one JSON object per line. No log shipper or external deps.

| Event | When |
|---|---|
| `server.start` | Listener ready (`url`, `origin`, `live`) |
| `http.request` | After each response finishes |
| `server.error` | Uncaught handler error before a normal response |

### Fields (`http.request`)

| Field | Meaning |
|---|---|
| `method` | HTTP verb |
| `path` | URL **pathname** only (query string omitted) |
| `status` | Response status code |
| `durationMs` | Wall time for the request |
| `live` | Whether the journal source is live SQLite (optional) |

### What is never logged

- Request or response **bodies** (including HITL `decision` text)
- Journal rows, replay payloads, or export contents
- Headers (no `Authorization`, cookies, or API keys)
- Query strings (avoids echoing arbitrary client input)

### Environment

| Variable | Default | Effect |
|---|---|---|
| `DURABL_LOG_LEVEL` | `info` | Minimum level: `debug` \| `info` \| `warn` \| `error` |
| `DURABL_LOG_REQUESTS` | on | Set `0`, `false`, or `off` to disable `http.request` lines |

Example:

```json
{"ts":"2026-06-01T12:00:00.000Z","level":"info","event":"http.request","method":"GET","path":"/api/runs","status":200,"durationMs":3,"live":true}
```

---

## Related

- M3 replay UI: [`docs/m3-observability-replay.md`](m3-observability-replay.md)
- Hardening / provider HTTP: [`docs/HARDENING.md`](HARDENING.md)
- Config paths: `src/config.ts`
