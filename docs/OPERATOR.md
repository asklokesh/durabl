# durabl — production operator guide

Concise reference for self-hosting the replay UI, SDK service, and journal data.
For first-run demos see [QUICKSTART.md](./QUICKSTART.md). For tagged releases see
[RELEASING.md](./RELEASING.md).

---

## Network bind

| Component | Default | Override |
|-----------|---------|----------|
| Replay UI | `127.0.0.1:7878` | `DURABL_UI_HOST`, `DURABL_UI_PORT` |
| SDK service (Restate target) | `:9080` on all interfaces when started | `DURABL_SERVICE_PORT` |
| Restate ingress / admin | `http://localhost:8080` / `:9070` | `DURABL_RESTATE_INGRESS`, `DURABL_RESTATE_ADMIN` |

The UI server binds **localhost by default** (`127.0.0.1`) so a laptop demo never
listens on all interfaces by accident. Production pattern:

1. Keep the Node process on loopback (default) or bind `127.0.0.1` explicitly.
2. Put **TLS termination** on a reverse proxy or ingress (nginx, Caddy, Traefik,
   cloud LB) in front of the UI port.
3. Set `DURABL_API_KEY` (and `DURABL_CORS_ORIGINS` if the browser origin differs
   from the UI host) before any non-local exposure.

Only set `DURABL_UI_HOST=0.0.0.0` when the proxy reaches the container/pod
directly and you still enforce auth at the edge. Do not expose the UI to the
public internet without TLS and `DURABL_API_KEY`.

**Example (nginx → loopback UI):** proxy `https://durabl.example.com` to
`http://127.0.0.1:7878`; forward `Authorization` / `x-durabl-api-key` unchanged.
WebSocket upgrades for `/api/ws/runs` need `proxy_http_version 1.1` and
`Upgrade` / `Connection` headers when `DURABL_ENABLE_WS=1` (see below).

Health: `GET /health`, `GET /ready`, `GET /metrics` (Prometheus stub). See
[BACKEND.md](./BACKEND.md).

---

## Authentication (`DURABL_API_KEY`)

| Setting | Effect |
|---------|--------|
| *(unset)* | No API auth on mutating `/api/*` |
| Non-empty `DURABL_API_KEY` | `POST` / `PUT` / `PATCH` / `DELETE` on `/api/*` require the secret |

Clients send the key via `Authorization: Bearer <key>` or header
`x-durabl-api-key`. Failures return `401` with `{ "error": "unauthorized" }`.
No default key is shipped — generate and inject via your secret manager.

Read-only routes (`GET /api/*`) stay unauthenticated.

### Rotation runbook (no secrets in repo)

There is a **single** active key per UI process (no dual-key grace period in code).

1. Generate a new random secret in your secret manager (e.g. 32+ bytes, base64 or hex).
2. Update the deployment secret / ConfigMap value for `DURABL_API_KEY` (never commit it).
3. **Rolling restart** each UI replica so all pick up the new value.
4. Update automation clients (scripts, CI smoke) to send the new key on mutating calls.
5. Revoke or delete the old secret material in the store after all replicas report healthy.

Mutating calls during restart may see brief `401` until the new env is loaded.
There is no key in git history by design — rotate on compromise or cadence, not on upgrade.

Details: [HARDENING.md](./HARDENING.md), `src/api-auth.ts`, `src/http-security.ts`.

---

## CORS (`DURABL_CORS_ORIGINS`)

| Setting | Effect |
|---------|--------|
| *(unset)* | No CORS headers; same-origin browser use only |
| Comma-separated origins | Allowlisted `Origin` values get `Access-Control-Allow-*` on `/api/*` |

Example: `DURABL_CORS_ORIGINS=https://ops.example.com,https://staging.example.com`

Preflight `OPTIONS` from disallowed origins returns **403**. Allowed methods:
`GET`, `POST`, `OPTIONS`. Allowed request headers: `content-type`, `authorization`
(Bearer carries `DURABL_API_KEY` when configured).

### Security headers (all responses)

Applied on every response via `applySecurityHeaders` — full HTTP surface documented in
[BACKEND.md](./BACKEND.md) (`src/http-security.ts`, `src/server.ts`):

| Header | Value |
|--------|--------|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `no-referrer` |

CORS and API key behavior are env-driven; headers are always on.

---

## Rate limits

| Surface | Limit | Scope |
|---------|-------|--------|
| `POST /api/hitl/input` | 30 requests / 60 s | Per `runId` (in-memory token bucket) |

Constants are fixed in `src/hitl-input-rate-limit.ts` (not env-tunable today).
Excess HITL submits receive **429** with a JSON error body. Limits reset on process
restart — for multiple UI replicas, use a shared edge rate limiter (nginx `limit_req`,
API gateway, etc.) in addition to the in-process bucket.

Other mutating routes (`POST /api/fork`, etc.) are **not** rate-limited in-process;
protect them with `DURABL_API_KEY` and edge policy.

Provider HTTP retries (429/5xx from OpenAI/Anthropic/OpenRouter) are separate;
see [HARDENING.md](./HARDENING.md).

---

## Live vs offline HITL

| Capability | Live (`durabl ui`, SQLite + Restate) | Offline (`durabl ui --from export.jsonl`) |
|------------|--------------------------------------|-------------------------------------------|
| Run list, fork tree, timeline, diff | ✅ | ✅ |
| `GET /api/hitl/paused`, `GET /api/hitl/status` | ✅ | ✅ (from export) |
| `POST /api/hitl/input` (resume) | ✅ | **503** by design |
| `/api/health` → `live` | `true` | `false` (`origin`: imported path) |
| WebSocket `/api/ws/runs` | ✅ when `DURABL_ENABLE_WS=1` | **503** on upgrade |

Offline **503** is intentional: exported JSONL has no Restate ingress to resume.
Operators audit paused runs from exports; resume only on a live stack.

UI copy and API contract: [UI.md](./UI.md), [hitl-web-ui.md](./hitl-web-ui.md),
[TROUBLESHOOTING.md](./TROUBLESHOOTING.md#offline-hitl-post-apihitlinput-returns-503).

---

## WebSocket runs feed (opt-in)

Disabled by default. Enable only when a live UI needs push updates for one run.

| Variable | Default | Effect |
|----------|---------|--------|
| `DURABL_ENABLE_WS` | *(unset)* | Set to `1` to allow upgrade on `GET /api/ws/runs?runId=…` |
| `DURABL_WS_POLL_MS` | `500` | Journal poll interval (clamped 100–10000 ms) |

**Runbook:**

1. Run UI in **live** mode with Restate ingress reachable (`DURABL_RESTATE_INGRESS`).
2. Set `DURABL_ENABLE_WS=1` on the UI process (ConfigMap / unit env).
3. Clients connect with WebSocket upgrade to `/api/ws/runs?runId=<id>` on the same
   host as the UI (through the TLS proxy if used).
4. If disabled, upgrade returns **404** (`WebSocket disabled`). Offline import returns **503**.

`GET /api/health` includes `wsEnabled` and `wsPath` when WS is on. Implementation:
`src/ws-runs.ts`, [BACKEND.md](./BACKEND.md).

---

## Data paths and backup

| Asset | Default path | Override |
|-------|--------------|----------|
| Step journal (SQLite) | `<DURABL_DATA_DIR>/journal.db` | `DURABL_JOURNAL_DB` |
| Effect sink | `<DURABL_DATA_DIR>/effects.db` | `DURABL_EFFECT_DB` |
| Restate local data | `<DURABL_DATA_DIR>/restate-data` | `DURABL_RESTATE_DATA_DIR` |

**Backup (recommended):**

1. **Portable export (substrate-independent):**  
   `durabl export-bundle <rootRunId> > backup.jsonl`  
   Replay offline: `durabl ui --from backup.jsonl` (no Restate required).
2. **Filesystem snapshot:** stop writes, copy `journal.db`, `effects.db`, and
   Restate data dir together for point-in-time recovery on the same host.

Export format: [JOURNAL-SCHEMA.md](./JOURNAL-SCHEMA.md), [m3-observability-replay.md](./m3-observability-replay.md).

---

## Deploy stacks

| Target | Doc | Notes |
|--------|-----|--------|
| **Docker Compose** | [QUICKSTART.md §6](./QUICKSTART.md#6-docker-demo-stack-optional-5–10-min-first-build), [`docker-compose.yml`](../docker-compose.yml) | Profile `docker-demo`; register deployment after `up` |
| **Kubernetes** | [`deploy/k8s/README.md`](../deploy/k8s/README.md) | M4 `external` target; ConfigMap env, PVCs for Restate + durabl data |

Set `DURABL_DEPLOY_TARGET=external` when Restate runs outside the host binary
path. SDK service (`dist/service.js`) must be registered with Restate admin after
each stack start.

---

## Gate cadence (`gate:all`)

Run the full serial suite **before** tagging a release or merging harness /
port / lifecycle changes:

```bash
npm run gate:all
```

Expect ~15–25 minutes. The Release CI workflow runs typecheck + build + pack
only — **not** `gate:all`. Capture evidence locally if needed (`docs/evidence/`).

Individual gates while iterating: [DEVELOPMENT.md](./DEVELOPMENT.md#gates).
Harness lock recovery: [TROUBLESHOOTING.md](./TROUBLESHOOTING.md).

### Live provider smoke (`gate:live`)

Optional; keys only in the shell, never in the repo:

```bash
export OPENROUTER_API_KEY='…'   # from secret store
export DURABL_MODEL_PROVIDER=openrouter
npm run gate:live
```

Without any provider key, `gate:live` prints `SKIP` and **exits 0** (CI-safe).

**OpenRouter:** the template default `openai/gpt-oss-120b:free` often returns **503**
(`no healthy upstream`). For a reliable smoke use:

```bash
export DURABL_OPENROUTER_MODEL=openai/gpt-4o-mini
```

(verified PASS 2026-06-03 — [`docs/evidence/gate-live-20260603-gpt4o-mini.log`](./evidence/gate-live-20260603-gpt4o-mini.log)).

Full detail: [DEVELOPMENT.md](./DEVELOPMENT.md#live-provider-gate-gatelive).

---

## Related

- HTTP routes: [API.md](./API.md)
- Env template: [`.env.example`](../.env.example)
- Security policy: [SECURITY.md](../SECURITY.md)
