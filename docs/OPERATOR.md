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

The UI server binds **localhost by default** (`127.0.0.1`). For remote access, set
`DURABL_UI_HOST=0.0.0.0` and terminate TLS at a reverse proxy (nginx, ingress
controller). Do not expose the UI directly to the public internet without auth.

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

Read-only routes (`GET /api/*`) stay unauthenticated. Rotate by updating the env
var and restarting the UI process.

Details: [HARDENING.md](./HARDENING.md), `src/api-auth.ts`.

---

## CORS (`DURABL_CORS_ORIGINS`)

| Setting | Effect |
|---------|--------|
| *(unset)* | No CORS headers; same-origin browser use only |
| Comma-separated origins | Allowlisted `Origin` values get `Access-Control-Allow-*` on `/api/*` |

Example: `DURABL_CORS_ORIGINS=https://ops.example.com,https://staging.example.com`

Preflight `OPTIONS` from disallowed origins returns **403**. Allowed methods:
`GET`, `POST`, `OPTIONS`.

---

## Rate limits

| Surface | Limit | Scope |
|---------|-------|--------|
| `POST /api/hitl/input` | 30 requests / 60 s | Per `runId` (in-memory token bucket) |

Excess submissions receive **429**. Limits reset per process restart — for
multi-instance deployments, place a shared rate limiter in front of the UI.

Provider HTTP retries (429/5xx from OpenAI/Anthropic/OpenRouter) are separate;
see [HARDENING.md](./HARDENING.md).

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

Optional live LLM smoke (keys in shell, not in repo): [DEVELOPMENT.md](./DEVELOPMENT.md#live-provider-gate-gatelive).

---

## Related

- HTTP routes: [API.md](./API.md)
- Env template: [`.env.example`](../.env.example)
- Security policy: [SECURITY.md](../SECURITY.md)
