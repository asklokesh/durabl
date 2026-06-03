# durabl — development guide

How to develop durabl locally, in a dev container, with parallel git worktrees,
gate verification, and harness locking.

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Node.js ≥ 22.5** | Required for built-in `node:sqlite`. Pin with [`.nvmrc`](../.nvmrc): `nvm use`. |
| **macOS or Linux** | Harness cleanup uses `pkill` on `restate-server`. |
| **npm** | Ships with Node; use `npm ci` in CI-like flows. |

Optional:

- **Docker** — M4 deploy-target gate (`DURABL_DEPLOY_TARGET=docker`) and `docker compose` demo stack.
- **`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY`** — live-provider gate (`npm run gate:live`).

## Live provider gate (`gate:live`)

`npm run gate:live` exercises **real** HTTP to configured LLM providers when keys
are present. Without any provider key, the gate prints `SKIP` and **exits 0**
(CI-safe). Never commit keys; export them in the shell only.

**OpenRouter example** (no secrets in files):

```bash
export OPENROUTER_API_KEY='…'          # from your secret store / shell
export DURABL_MODEL_PROVIDER=openrouter
# optional: export DURABL_OPENROUTER_MODEL=openai/gpt-oss-120b:free
# optional: export OPENROUTER_BASE_URL=https://openrouter.ai/api/v1

npm run gate:live
```

With `OPENROUTER_API_KEY` set, the gate asserts real completions, replay
short-circuit, and export/import parity for the `openrouter` provider. OpenAI and
Anthropic paths run when their respective keys are set (same gate).

Full matrix: [HARDENING.md](./HARDENING.md), [TEST-MATRIX.md](./TEST-MATRIX.md).

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

## Single checkout

```bash
git clone <fork> durabl && cd durabl
nvm use          # if using nvm
npm install
npm run build
npm run typecheck
npm test
```

See `docs/QUICKSTART.md` for the first-run narrative and `CONTRIBUTING.md`
for PR conventions.

## Parallel worktrees

Large features were developed in sibling directories next to the main clone.
Each worktree is a separate checkout on its own branch, sharing one `.git`
object store.

**Main repo**

```bash
/Users/lokesh/git/durabl          # branch: main
```

**Current finalization worktrees** (`feat/final-*` branches — one concern per
directory):

| Directory | Branch |
|---|---|
| `durabl-worktrees` | `feat/final-worktrees` |
| `durabl-arch` | `feat/final-arch` |
| `durabl-ci` | `feat/final-ci` |
| `durabl-docs` | `feat/final-docs` |
| … | … |

Create a new worktree from `main`:

```bash
cd /path/to/durabl
git worktree add ../durabl-my-feature -b feat/my-feature
cd ../durabl-my-feature
npm install
```

Remove a worktree when the branch is merged:

```bash
git worktree remove ../durabl-my-feature
# or, from any checkout:
git worktree remove /path/to/durabl-my-feature
```

### Cleanup: merged parallel tracks

These four worktrees backed the tracks merged in `docs/build-status.md` and
can be removed once you no longer need local evidence on those branches:

- `durabl-productize` (`feat/productize`)
- `durabl-fundability` (`feat/fundability`)
- `durabl-harden` (`feat/harden`)
- `durabl-hitl-web-ui` (`feat/hitl-web-ui`)

Dry run (default):

```bash
npm run cleanup:worktrees
```

Actually remove:

```bash
npm run cleanup:worktrees -- --force
```

The script never removes the main repo or the worktree you run it from.

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

## Gates

| Command | Scope |
|---|---|
| `npm test` | M1 — idempotency + crash recovery |
| `npm run gate:m2` … `gate:m5` | Milestone gates |
| `npm run gate:live` | Live providers (skips without API keys) |
| `npm run gate:harden` | HTTP retry + second-substrate seam |
| `npm run gate:hitl-ui` | HITL web UI API |
| `npm run gate:all` | Full serial suite (typecheck + M1–M5 + harden + hitl-ui) |

`gate:all` runs gates **one at a time** via `scripts/run-all-gates.sh`. It
teardowns Restate, the service process, and Docker helpers between each gate.
Expect several minutes on a clean machine.

Run individual gates while iterating; run `gate:all` before merge when your
change touches harness, ports, or shared lifecycle code.

Evidence and milestone status: [`build-status.md`](build-status.md), [`TEST-MATRIX.md`](TEST-MATRIX.md).

## Harness lock file

Every gate calls `enterHarnessGate()` before binding localhost ports and
releases the lock in `exitHarnessGate()`.

| Setting | Default |
|---|---|
| Lock path | `/tmp/durabl-harness.lock` |
| Override | `DURABL_HARNESS_LOCK=/path/to/lock` |

The lock is an exclusive PID file. Only one gate process may hold it. If a
prior run was SIGKILL'd mid-teardown, the next gate waits (up to ~15 minutes)
or reclaims the lock when the holder PID is dead.

Manual recovery:

```bash
rm -f /tmp/durabl-harness.lock
pkill -f restate-server 2>/dev/null || true
pkill -f 'dist/service.js' 2>/dev/null || true
```

`scripts/run-all-gates.sh` also clears the lock on exit.

## Parallel development warning

**Do not run gates in two worktrees at the same time.**

All checkouts share:

- The harness lock file (`/tmp/durabl-harness.lock` unless overridden)
- Localhost ports `8080`, `9070`, `9080`, `7879`, `17878`, `17879`
- Default Restate data under `/tmp/durabl-gate-*` when `DURABL_DATA_DIR` is unset

Running `npm test` in `durabl-arch` while `npm run gate:all` runs in
`durabl-ci` causes port conflicts, stale locks, and flaky failures that look
like product bugs but are environment races.

**Safe pattern:** one gate runner at a time across all worktrees; use
`gate:all` serially before landing harness changes.

Node version and `node_modules` are per worktree — run `npm install` in each
checkout after switching.

## Docker Compose demo

Operator-facing two-container stack (Restate + durabl service):

```bash
docker compose up --build
docker compose exec restate restate deployments register http://durabl:9080
```

From the host, set `DURABL_RESTATE_INGRESS=http://localhost:8080` when calling ingress. Details: [`QUICKSTART.md`](QUICKSTART.md).

## Environment variables (harness)

| Variable | Purpose |
|---|---|
| `DURABL_DATA_DIR` | Restate + effect-sink data root (gate scripts set a per-run temp dir) |
| `DURABL_HARNESS_LOCK` | Override harness lock path |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY` | Enable live-provider gates |

See `docs/HARDENING.md` and `src/config.ts` for the full config surface.

## Secrets and data

- Never commit `.env` or API keys.
- Journal and Restate data default under `/tmp/durabl-*` or `DURABL_DATA_DIR`.
- UI binds to localhost by default.

## Related docs

- [`../CONTRIBUTING.md`](../CONTRIBUTING.md) — PR expectations and conventions.
- [`QUICKSTART.md`](QUICKSTART.md) — 5-minute path for new contributors.
- [`OPERATOR.md`](OPERATOR.md) — production bind, auth, backup, deploy.
- [`m1-slice.md`](m1-slice.md) through [`m5-hitl-export.md`](m5-hitl-export.md) — milestone architecture.
