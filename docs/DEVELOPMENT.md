# Development guide

How to work on durabl locally, in a dev container, or against the Docker demo stack.

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Node.js ≥ 22.5** | Required for built-in `node:sqlite`. Pin with [`.nvmrc`](../.nvmrc): `nvm use`. |
| **macOS or Linux** | Harness cleanup uses `pkill` on `restate-server`. |
| **npm** | Ships with Node; use `npm ci` in CI-like flows. |

Optional:

- **Docker** — M4 deploy-target gate (`DURABL_DEPLOY_TARGET=docker`) and `docker compose` demo stack.
- **`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`** — live-provider hardening (`npm run gate:live`).

## Dev container (VS Code / Cursor)

Reopen the repo in a container: **Dev Containers: Reopen in Container**.

Configuration lives in [`.devcontainer/devcontainer.json`](../.devcontainer/devcontainer.json). The image is Node 22 on Debian Bookworm; `post-create` runs `npm install` and `npm run build`. Docker-outside-of-docker is enabled for M4 and `docker compose`.

Forwarded ports (defaults):

| Port | Use |
|------|-----|
| 7878 | Replay / HITL UI (`npm run ui`) |
| 8080 / 9070 | Restate ingress / admin (local harness) |
| 9080 | durabl SDK service |
| 8081 / 9071 / 9081 | M4 **docker** deploy target (when exercised) |

## Restate (local substrate)

Gates and the harness use a **real** Restate process — no mocks. Binaries come from npm devDependencies (offline, pinned to **1.6.2**):

```bash
npm install
ls node_modules/.bin/restate-server node_modules/.bin/restate
```

After install:

- **`restate-server`** — local server (`src/harness/restate-control.ts` sets `RESTATE_BASE_DIR` under `/tmp` or `DURABL_RESTATE_DATA_DIR`).
- **`restate`** — CLI for `restate deployments register http://localhost:9080` when you run the service manually.

You usually **do not** start Restate yourself for gates; `npm test` and `npm run gate:*` spawn and tear down `restate-server` via the harness lock.

Manual smoke (two terminals):

```bash
# Terminal A
node_modules/.bin/restate-server &
npm run service

# Terminal B (once admin is healthy)
node_modules/.bin/restate deployments register http://localhost:9080
npm test
```

Environment overrides (see `src/config.ts`): `DURABL_RESTATE_INGRESS`, `DURABL_RESTATE_ADMIN`, `DURABL_SERVICE_PORT`, `DURABL_DATA_DIR`.

## Install and build

```bash
git clone <fork-url> durabl && cd durabl
nvm use          # if using nvm
npm install
npm run build
npm run typecheck
```

## Gate suite

```bash
npm test              # M1
npm run gate:m2       # fork / trajectory
npm run gate:m3       # replay / offline export
npm run gate:m4       # deploy-target neutrality (needs Docker for container target)
npm run gate:m5       # HITL + export
npm run gate:all      # sequential full suite (bash scripts/run-all-gates.sh)
```

Evidence and milestone status: [`build-status.md`](build-status.md), [`TEST-MATRIX.md`](TEST-MATRIX.md).

## Docker Compose demo

Operator-facing two-container stack (Restate + durabl service):

```bash
docker compose up --build
docker compose exec restate restate deployments register http://durabl:9080
```

From the host, set `DURABL_RESTATE_INGRESS=http://localhost:8080` when calling ingress. Details: [`QUICKSTART.md`](QUICKSTART.md).

## Secrets and data

- Never commit `.env` or API keys.
- Journal and Restate data default under `/tmp/durabl-*` or `DURABL_DATA_DIR`.
- UI binds to localhost by default.

## Related docs

- [`../CONTRIBUTING.md`](../CONTRIBUTING.md) — PR expectations and conventions.
- [`QUICKSTART.md`](QUICKSTART.md) — 5-minute path for new contributors.
- [`m1-slice.md`](m1-slice.md) through [`m5-hitl-export.md`](m5-hitl-export.md) — milestone architecture.
