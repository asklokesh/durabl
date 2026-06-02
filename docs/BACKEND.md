# Replay UI HTTP server (`src/server.ts`)

Lightweight `node:http` server serving `web/` and journal APIs. Default: `127.0.0.1:7878` (`DURABL_UI_HOST`, `DURABL_UI_PORT`).

---

## Operations

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Liveness |
| `GET` | `/ready` | Live: Restate admin `/health`; offline: always ready |
| `GET` | `/metrics` | Prometheus stub (`durabl_ui_up`) |

## `/api/*` (journal)

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/api/health` | UI health + `hitlSubmitEnabled` |
| `GET` | `/api/runs` | Optional `limit` (1–500) |
| `GET` | `/api/hitl/paused` | Paused runs |
| `GET` | `/api/hitl/status` | `runId` |
| `POST` | `/api/hitl/input` | Live only; **503** offline; **429** rate limit |
| `GET` | `/api/replay` | `runId` |
| `GET` | `/api/state-at` | `runId`, `n` |
| `GET` | `/api/tree` | Fork tree + lineage |
| `GET` | `/api/diff` | `a`, `b` |

Fork/inspect data: `src/inspect-source.ts`.

## Security

- `DURABL_API_KEY` — mutating `/api/*`
- `DURABL_CORS_ORIGINS` — comma-separated allowlist
- `src/logging.ts` — no bodies/secrets in logs

See [`SECURITY.md`](../SECURITY.md).

## Tests

`npm run test:api`
