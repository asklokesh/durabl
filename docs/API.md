# Replay UI HTTP API

The local replay web server (`src/server.ts`, started via `npm run ui` or `durabl ui`) exposes JSON read APIs over the journal plus static assets under `web/`. There is no routing framework: paths are matched in `handleApi()`.

**Default base URL:** `http://127.0.0.1:7878` (override with `DURABL_UI_HOST`, `DURABL_UI_PORT`).

## Modes

| Mode | How started | `source.origin` | `live` | HITL submit |
|------|-------------|-----------------|--------|-------------|
| **Live** | `npm run ui` (default SQLite journal) | `live-sqlite-journal` | `true` | `POST /api/hitl/input` proxies to Restate ingress |
| **Offline** | `durabl ui --from <export.jsonl>` | `imported:<path>` | `false` | `POST /api/hitl/input` → **503** (paused runs still listed) |

`GET /api/health` exposes `live` and `hitlSubmitEnabled` (same value as `live`). Read endpoints work in both modes; reconstruction is journal-only (no live Restate state).

Related: [`hitl-web-ui.md`](hitl-web-ui.md), [`m3-observability-replay.md`](m3-observability-replay.md).

---

## JSON API (`/api/*`)

All JSON responses use `Content-Type: application/json; charset=utf-8` and `Cache-Control: no-store`.

### Common errors

| Status | Body | When |
|--------|------|------|
| `400` | `{ "error": "<message>" }` | Missing/invalid query params, invalid JSON body, replay/state-at failure |
| `404` | `{ "error": "not found" }` | Unknown `/api/...` path |
| `500` | `{ "error": "<message>" }` | Unhandled server error |
| `502` | `{ "error": "...", "runId": "...", "hint": "ensure Restate ingress..." }` | Live HITL submit: Restate `provideInput` failed |
| `503` | `{ "error": "HITL submit requires live mode...", "submitEnabled": false }` | Offline: `POST /api/hitl/input` |

---

### `GET /api/health`

Server and journal mode probe. Used by `web/app.js` (`loadSource`).

**Response `200`:**

```json
{
  "ok": true,
  "origin": "live-sqlite-journal",
  "source": "live-sqlite-journal",
  "label": "live SQLite journal",
  "live": true,
  "hitlSubmitEnabled": true
}
```

Offline example: `origin` / `source` like `imported:/path/to/export.jsonl`, `live` and `hitlSubmitEnabled` are `false`, `label` describes the import.

---

### `GET /api/runs`

List all runs with summary metadata and HITL state. Used by `web/app.js` (`loadRuns`).

**Response `200`:**

```json
{
  "source": "live-sqlite-journal",
  "label": "live SQLite journal",
  "roots": ["<rootRunId>"],
  "runs": [
    {
      "runId": "<id>",
      "trajectory": "main",
      "parentRun": null,
      "forkedAtSeq": null,
      "steps": 3,
      "createdAt": "2026-06-01T00:00:00.000Z",
      "hitlState": "none"
    }
  ]
}
```

`hitlState` is `"paused" | "resumed" | "none"` (journal-derived: `hitl_pause` without `hitl_input` → `paused`).

**Offline / live:** identical read semantics.

---

### `GET /api/replay?runId=<id>`

Full run reconstruction (`reconstruct()` in `src/replay.ts`). Used by `web/app.js` (`selectRun`).

**Query:** `runId` (required)

**Response `200`:** `ReplayedRun` — fields include:

| Field | Type | Description |
|-------|------|-------------|
| `runId` | string | |
| `trajectory` | string | |
| `meta` | `RunMeta` \| undefined | Fork lineage metadata |
| `steps` | `ReplayStep[]` | Ordered steps (`seq`, `stepName`, `kind`, `output`, `sideEffect`, `seeded`, `seededFrom`, `idemKey`, `recordedAt`, `elapsedMsFromPrev`, `effects`) |
| `totalElapsedMs` | number | Wall-clock span |
| `outcome` | unknown | Last step output |
| `effects` | `ReplayEffect[]` | All effects for the run |
| `divergencePoints` | `DivergencePoint[]` | Child forks from this run |
| `reconstructedFrom` | string | Journal source origin |

**Errors:** `400` if `runId` missing or reconstruction throws.

**Offline / live:** identical.

---

### `GET /api/state-at?runId=<id>&n=<N>`

Time-travel: state and effects **as of** step `N` inclusive (`stateAt()` in `src/replay.ts`). Not called by the current `web/app.js`; used by M3 gate / CLI parity.

**Query:** `runId` (required), `n` (required, integer ≥ 1, ≤ max step seq)

**Response `200`:** `StateAsOf` — `runId`, `n`, `maxSeq`, `steps`, `currentOutput`, `effects`, `divergedSoFar`, `reconstructedFrom`.

**Errors:** `400` if `runId` missing or `n` out of range.

**Offline / live:** identical.

---

### `GET /api/tree?runId=<id>`

Fork tree and lineage for a run (`forkTreeFrom`, `lineageFrom`). Used by `web/app.js` (`renderTree`).

**Query:** `runId` (required) — tree is rooted at this run id.

**Response `200`:**

```json
{
  "tree": {
    "runId": "<id>",
    "trajectory": "main",
    "forkedAtSeq": null,
    "children": []
  },
  "lineage": [
    {
      "runId": "<id>",
      "trajectory": "main",
      "parentRun": null,
      "forkedAtSeq": null
    }
  ]
}
```

`lineage` is root → … → `runId`. `tree` is the descendant fork forest from `runId`.

**Errors:** `400` if `runId` missing.

**Offline / live:** identical.

---

### `GET /api/diff?a=<runA>&b=<runB>`

Per-sequence trajectory diff (`diffTrajectoriesFrom`). Used by `web/app.js` (diff panel).

**Query:** `a`, `b` (both required)

**Response `200`:** `TrajectoryDiff` — `runA`, `runB`, `firstDivergenceSeq` (number \| null), `steps[]` with `seq`, `status` (`same` \| `changed` \| `only_a` \| `only_b`), `stepName`, `aOutput`, `bOutput`, `seeded`.

**Errors:** `400` if `a` or `b` missing.

**Offline / live:** identical.

---

### `GET /api/hitl/paused`

Runs with journal state `paused` (`hitl_pause` present, no `hitl_input`). Used by `web/app.js` (`loadHitlPaused`).

**Response `200`:**

```json
{
  "source": "live-sqlite-journal",
  "live": true,
  "submitEnabled": true,
  "paused": [
    {
      "runId": "<id>",
      "hitlState": "paused",
      "pauseOutput": { },
      "steps": 2
    }
  ]
}
```

`pauseOutput` is the `output` of the `hitl_pause` step, or `null` if none.

**Offline / live:** list works offline from export; `submitEnabled` is `false` when offline.

---

### `GET /api/hitl/status?runId=<id>`

HITL state for one run. Used by `web/app.js` (`refreshHitlForRun`).

**Query:** `runId` (required)

**Response `200`:**

```json
{
  "runId": "<id>",
  "state": "paused",
  "live": true,
  "submitEnabled": true
}
```

`submitEnabled` is `live && state === "paused"`.

**Errors:** `400` if `runId` missing.

**Offline / live:** read works offline; `submitEnabled` is `false` offline even when `state` is `paused`.

---

### `POST /api/hitl/input`

Submit human decision; resolves the durable HITL promise via Restate ingress (`provideInputViaIngress` → `POST {DURABL_RESTATE_INGRESS}/HitlAgentRun/{runId}/provideInput` with body `{ "decision": "<string>" }`). Used by `web/app.js` (`submitHitlInput`).

**Request body (JSON):**

```json
{
  "runId": "<id>",
  "decision": "<non-empty string>"
}
```

| Case | Status | Body |
|------|--------|------|
| **Offline import** | `503` | `{ "error": "HITL submit requires live mode...", "submitEnabled": false }` |
| Missing `runId` / `decision` | `400` | `{ "error": "..." }` |
| No `hitl_pause` on run | `404` | `{ "error": "run has no HITL pause", "runId", "state": "none" }` |
| Already resumed (`hitl_input` journaled) | `200` | `{ "runId", "accepted": false, "state": "resumed", "note": "human input already journaled; duplicate submit is a no-op" }` |
| Ingress success | `200` | `{ "runId", "accepted": <bool>, "state": "<current HitlState>" }` (from Restate + re-read journal) |
| Ingress failure | `502` | `{ "error", "runId", "hint" }` |

**Live only** for successful substrate resume. Offline can still **read** paused runs via `GET /api/hitl/paused` and `GET /api/hitl/status`.

---

## Static assets (non-API)

Served when the path does **not** start with `/api/`. Path traversal is blocked (`webFile()`).

| Method | Path | File | Used by UI |
|--------|------|------|------------|
| `GET` | `/` | `web/index.html` | Yes |
| `GET` | `/index.html` | `web/index.html` | |
| `GET` | `/app.js` | `web/app.js` | Yes |
| `GET` | `/app.css` | `web/app.css` | Yes |

Unknown files: `404` `text/plain` `not found`. Missing asset falls back to `index.html` for SPA-style paths.

`web/app.js` only calls the JSON endpoints listed above (not `/api/state-at`).

---

## Source of truth

Route registration and handlers: `src/server.ts` (`handleApi`, `handleHitlInput`). Response shapes: `src/replay.ts`, `src/inspect-source.ts`, `src/hitl-source.ts`. Client usage: `web/app.js`.
