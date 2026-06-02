# Replay UI HTTP API

**OpenAPI 3:** [`openapi.yaml`](../openapi.yaml) — paths and schemas from `src/server.ts` only.

The local replay web server (`src/server.ts`, started via `npm run ui` or `durabl ui`) exposes JSON read APIs over the journal plus static assets under `web/`. Paths are matched in `handleApi()`.

**Default base URL:** `http://127.0.0.1:7878` (`DURABL_UI_HOST`, `DURABL_UI_PORT`).

| Method | Path | OpenAPI |
|--------|------|---------|
| GET | `/api/health` | [`getHealth`](../openapi.yaml#/paths/~1api~1health/get) |
| GET | `/api/runs` | [`listRuns`](../openapi.yaml#/paths/~1api~1runs/get) |
| GET | `/api/replay` | [`getReplay`](../openapi.yaml#/paths/~1api~1replay/get) |
| GET | `/api/state-at` | [`getStateAt`](../openapi.yaml#/paths/~1api~1state-at/get) |
| GET | `/api/tree` | [`getTree`](../openapi.yaml#/paths/~1api~1tree/get) |
| GET | `/api/diff` | [`getDiff`](../openapi.yaml#/paths/~1api~1diff/get) |
| GET | `/api/hitl/paused` | [`listHitlPaused`](../openapi.yaml#/paths/~1api~1hitl~1paused/get) |
| GET | `/api/hitl/status` | [`getHitlStatus`](../openapi.yaml#/paths/~1api~1hitl~1status/get) |
| POST | `/api/hitl/input` | [`postHitlInput`](../openapi.yaml#/paths/~1api~1hitl~1input/post) |

## Modes

| Mode | How started | `live` | HITL submit |
|------|-------------|--------|-------------|
| **Live** | `npm run ui` | `true` | `POST /api/hitl/input` → Restate ingress |
| **Offline** | `durabl ui --from <export.jsonl>` | `false` | **503** (paused runs still listed) |

Related: [`hitl-web-ui.md`](hitl-web-ui.md), [`m3-observability-replay.md`](m3-observability-replay.md).

## Common errors

| Status | Body | When |
|--------|------|------|
| `400` | `{ "error": "..." }` | Missing params, invalid JSON, replay/state-at failure |
| `404` | `{ "error": "not found" }` | Unknown `/api/*` path |
| `500` | `{ "error": "..." }` | Unhandled error |
| `502` | `{ "error", "runId", "hint" }` | Live HITL: Restate `provideInput` failed |
| `503` | `{ "error", "submitEnabled": false }` | Offline `POST /api/hitl/input` |

## Endpoints (summary)

### `GET /api/health`

`200`: `{ ok, origin, source, label, live, hitlSubmitEnabled }`.

### `GET /api/runs`

`200`: `{ source, label, roots[], runs[] }` — each run includes `hitlState` (`paused` \| `resumed` \| `none`).

### `GET /api/replay?runId=`

`200`: `ReplayedRun` from `reconstruct()` — see [`openapi.yaml`](../openapi.yaml#/components/schemas/ReplayedRun).

### `GET /api/state-at?runId=&n=`

`200`: `StateAsOf` from `stateAt()`. `400` if `n` out of range.

### `GET /api/tree?runId=`

`200`: `{ tree: ForkTreeNode, lineage: LineageNode[] }`.

### `GET /api/diff?a=&b=`

`200`: `TrajectoryDiff` — `firstDivergenceSeq`, per-seq `status` (`same` \| `changed` \| `only_a` \| `only_b`).

### `GET /api/hitl/paused`

`200`: `{ source, live, submitEnabled, paused[] }`.

### `GET /api/hitl/status?runId=`

`200`: `{ runId, state, live, submitEnabled }` — `submitEnabled` is `live && state === "paused"`.

### `POST /api/hitl/input`

Body `{ runId, decision }`. Live only for substrate resume; offline **503**. See OpenAPI [`postHitlInput`](../openapi.yaml#/paths/~1api~1hitl~1input/post) for all status bodies.

## Static assets

Non-`/api/*` paths serve `web/` (`/`, `/app.js`, `/app.css`). Not part of [`openapi.yaml`](../openapi.yaml).

## Source of truth

Handlers: `src/server.ts` (`handleApi`, `handleHitlInput`). Shapes: `src/replay.ts`, `src/inspect-source.ts`, `src/hitl-source.ts`. Client: `web/app.js`.
