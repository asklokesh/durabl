# durabl

**durabl** is a neutral, self-hostable **agent execution journal** with **replay /
time-travel**, **logical step-level fork**, and **human-in-the-loop pause/resume**.
It uses [Restate](https://restate.dev) as the durable step-journal substrate and
never relies on process snapshots (CRIU) — only portable journal records and
structural per-step idempotency.

**Wedge (what you get today):** a TypeScript library + CLI that proves durable
agent runs survive real crashes, fork to alternate trajectories without
re-firing side effects, reconstruct runs offline from JSONL exports, and resume
HITL workflows after a full substrate restart (CLI or replay UI).

**Python:** not shipped yet (Phase 0 fast-follow). Status, target API, and
LangGraph integration sketch: [`docs/PYTHON-SDK.md`](docs/PYTHON-SDK.md).

Phase 0 showed the **durable execution engine** wedge is closed (Google AX,
Temporal, Restate, and others). durabl targets what remains: **your history in
your infra**, demonstrable offline after export.

**Completion checklist** (M0–M5, post-M5 tracks, verified vs config-ready):
[`docs/COMPLETION.md`](docs/COMPLETION.md).

Investor narrative and live demo script: [`docs/FUNDING.md`](docs/FUNDING.md),
[`docs/DEMO-NARRATIVE.md`](docs/DEMO-NARRATIVE.md),
[`docs/RISKS.md`](docs/RISKS.md).

## Install

**v0.1.0 dual channel:** GitHub **release tarball** (always) or **npmjs.org** after
maintainer publish. See [`docs/RELEASING.md`](docs/RELEASING.md). As of the latest
release prep, `npm view durabl` returns 404 — use tarball or source until registry
publish completes.

| Path | When | Steps |
|------|------|--------|
| **From npm** | Registry publish live (`npm view durabl version`) | `npm install durabl@0.1.0` |
| **From tarball** | Tagged release / offline / pre-registry | Download `durabl-<version>.tgz` from GitHub Actions for tag `v*`, then `npm install /path/to/durabl-0.1.0.tgz` |
| **From source** | Contributors, local dev | `git clone https://github.com/asklokesh/durabl.git && cd durabl && npm install && npm run build` |

After install, the `durabl` CLI is on your PATH when installed globally, or invoke
via `npx durabl` / `node dist/cli.js` from a source checkout.

## Quickstart

**Prerequisites:** Node.js **>= 22.5.0** (uses built-in `node:sqlite`). macOS or
Linux recommended for the adversarial harness.

Complete [Install](#install) first (registry, tarball, or git clone). If
`npm view durabl` is 404, use tarball or source — not `npm install durabl`. The
commands below run in that tree (or after `npm install durabl@0.1.0` /
`npm install /path/to/durabl-*.tgz`).

```bash
npm install
npm run build          # optional; demo/test build automatically
npm run demo           # scripted M1+M2 narrative (real SIGKILL + fork)
npm run ui             # replay UI → http://127.0.0.1:7878
```

**Makefile** (same commands; requires `make`):

| Target | npm equivalent | Purpose |
|--------|----------------|---------|
| `make demo` | `npm run demo` | Scripted M1+M2 narrative |
| `make ui` | `npm run ui` | Replay UI on http://127.0.0.1:7878 |
| `make test` | `npm test` | M1 adversarial gate |
| `make gate-all` | `npm run gate:all` | Full serial gate suite (slow) |
| `make typecheck` | `npm run typecheck` | TypeScript check only |
| `make clean-data` | — | Remove harness data dirs + `/tmp/durabl-harness.lock` (respects `DURABL_DATA_DIR`) |

Build artifacts: `npm run clean` (not `make clean-data`).

One-liner:

```bash
./scripts/quickstart.sh
```

CLI (after `npm run build`; full reference: [`docs/CLI.md`](docs/CLI.md)):

```bash
npx durabl --help
npx durabl <command> --help    # per-command usage

# Journal-only (inspect / replay / export)
npx durabl runs
npx durabl inspect <runId>
npx durabl replay <runId>
npx durabl export-bundle <runId> > bundle.jsonl
npx durabl ui --from bundle.jsonl   # offline replay (fork tree in bundle)

# Requires Restate ingress (see DURABL_RESTATE_INGRESS)
npx durabl run <runId> --prompt "…"
npx durabl fork <source> --at <N> --new <id> --prompt "…"
npx durabl hitl-run <runId> --prompt "…"
npx durabl hitl-input <runId> --decision "…"
```

**Verify (CI-style):**

```bash
npm run gate:all      # typecheck + M1–M5 + harden + hitl-ui (serial; ~15–25 min)
```

Individual gates:

```bash
npm test              # M1 gate (== npm run gate)
npm run gate:m2       # logical fork gate
npm run gate:m3       # replay + offline UI APIs
npm run gate:m4       # provider/deploy neutrality
npm run gate:m5       # HITL pause/resume + export
npm run gate:hitl-ui  # HITL web UI resume + offline 503
npm run gate:live     # real LLM providers (skip if no API keys)
```

HTTP routes for the replay UI (`/api/*` and static `web/`): [`docs/API.md`](docs/API.md).

**Stuck gate / stop harness loop:** if a gate was SIGKILL'd or ports are wedged, clear the harness lock and child processes before re-running:

```bash
rm -f /tmp/durabl-harness.lock
pkill -9 -f restate-server 2>/dev/null || true
pkill -9 -f dist/service.js 2>/dev/null || true
pkill -9 -f 'dist/harness/run-' 2>/dev/null || true
```

Then run gates **one at a time** or `npm run gate:all` (which tears down between gates). See [`docs/build-status.md`](docs/build-status.md).

## Milestone proof

Full matrix, evidence paths, and reproduce commands:
[`docs/build-status.md`](docs/build-status.md).

| Milestone | Scope | Gate | Status |
|-----------|--------|------|--------|
| **M0** | Feasibility: fork + replay without engine mods | spike | ✅ |
| **M1** | Portable journal + structural exactly-once | `npm test` | ✅ 10/10 |
| **M2** | Logical trajectory fork + inspect APIs | `npm run gate:m2` | ✅ 6/6 |
| **M3** | Replay / time-travel + offline export + UI | `npm run gate:m3` | ✅ 5/5 |
| **M4** | Model + deploy neutrality (config-only) | `npm run gate:m4` | ✅ 4/4 |
| **M5** | HITL pause/resume across real restart | `npm run gate:m5` | ✅ 5/5 |

Deep dives: [`docs/m1-slice.md`](docs/m1-slice.md),
[`docs/m2-trajectory-branching.md`](docs/m2-trajectory-branching.md),
[`docs/m3-observability-replay.md`](docs/m3-observability-replay.md),
[`docs/m4-neutrality.md`](docs/m4-neutrality.md),
[`docs/m5-hitl-export.md`](docs/m5-hitl-export.md).

Phase 0 background: [`docs/phase0/`](docs/phase0/).

**Roadmap (M6+):** [`docs/ROADMAP.md`](docs/ROADMAP.md) — managed layer, Python SDK,
DBOS parity (honest status).

**Comparison:** [`docs/COMPARISON.md`](docs/COMPARISON.md) — vs LangSmith, Braintrust,
Google AX (cites Phase 0 [`validation-report.md`](docs/phase0/validation-report.md)).

## Architecture

Full layer diagram, `src/` map, and data flows:
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

At a glance: Restate provides crash-durable steps; durabl owns the portable
journal (`journal.ts`), structural idempotency (`idempotency.ts` +
`effect-sink.ts`), logical fork (`fork.ts`), and substrate-independent replay
(`journal-source.ts` + `replay.ts` + `web/` UI).

## Optional: Restate in Docker

The default path uses **native** `restate-server` from npm (no Docker). For a
containerized substrate (`docker-compose.yml`, profile **`docker-demo`**):

- **restate** exposes ingress `:8080` and admin `:9070`; its healthcheck probes
  `http://127.0.0.1:9070/health` (same endpoint the harness uses).
- **durabl** starts only after Restate is healthy (`depends_on` +
  `service_healthy`), then serves the SDK on `:9080`.

```bash
docker compose --profile docker-demo config   # validate compose file
docker compose --profile docker-demo up -d    # or: npm run compose:up
docker compose --profile docker-demo ps       # restate should show (healthy)

docker compose --profile docker-demo exec restate \
  restate deployments register http://durabl:9080

export DURABL_RESTATE_INGRESS=http://127.0.0.1:8080
export DURABL_RESTATE_ADMIN=http://127.0.0.1:9070
npm run demo
```

Stop: `docker compose --profile docker-demo down`.

## Layout

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the complete `src/` tree.
Top-level: `src/` (library + CLI + harness), `web/` (replay UI), `docs/`.
`python/` is reserved for a future SDK — see [`docs/PYTHON-SDK.md`](docs/PYTHON-SDK.md) (DEFERRED).

```
src/
  idempotency.ts      # branded IdempotencyKey
  step-model.ts       # neutral journal types (schema v1)
  journal.ts          # SQLite journal + JSONL export + forkRun
  effect-sink.ts      # exactly-once effect boundary
  workflow.ts         # reference agent loop on Restate
  replay.ts           # reconstruct / state-at
  fork.ts             # logical fork + forkAndRun
  cli.ts              # durabl CLI
  harness/            # adversarial gates + demo
web/                  # replay UI static assets
python/               # reserved; see docs/PYTHON-SDK.md (DEFERRED)
```

## Configuration

Copy [`.env.example`](.env.example) to `.env` for the full list of `DURABL_*`
variables (data paths, deploy target, Restate ports, model providers, UI, harness
toggles). All entries are commented placeholders — no secrets in the template.

| Variable | Default | Purpose |
|----------|---------|---------|
| `DURABL_DATA_DIR` | `$TMPDIR/durabl-m1` | Root for journal/effect/engine data |
| `DURABL_JOURNAL_DB` | `<root>/journal.db` | Portable step journal |
| `DURABL_EFFECT_DB` | `<root>/effects.db` | Idempotent effect sink |
| `DURABL_DEPLOY_TARGET` | `local` | `local` \| `docker` \| `external` |
| `DURABL_MODEL_PROVIDER` | `fake-echo` | Provider id (config-only switch) |
| `DURABL_SERVICE_PORT` | `9080` | Restate SDK service port |
| `DURABL_RESTATE_INGRESS` | `http://localhost:8080` | Restate ingress |
| `DURABL_RESTATE_ADMIN` | `http://localhost:9070` | Restate admin |

Real provider keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`) live
outside `DURABL_*`; never commit them. Set `DURABL_MODEL_PROVIDER=openrouter` with
`OPENROUTER_API_KEY` (optional `OPENROUTER_BASE_URL`, default `https://openrouter.ai/api/v1`)
for OpenRouter. No credentials are read or logged by durabl itself.

## Security

Private vulnerability reporting, no secrets in public issues, env-var-only
credentials, and self-host data boundaries:
[`SECURITY.md`](SECURITY.md).

## Docs

| Doc | Purpose |
|-----|---------|
| [`docs/FAQ.md`](docs/FAQ.md) | Common questions (journal, replay, HITL, gates) |
| [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) | Harness lock, port conflicts, SIGKILL teardown, offline HITL 503 |
| [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) | Worktrees, serial gates, harness locking |
| [`docs/QUICKSTART.md`](docs/QUICKSTART.md) | First-run walkthrough |
| [`docs/RELEASING.md`](docs/RELEASING.md) | Tag releases, tarball install (v0.1.0 channel) |
| [`docs/OPERATOR.md`](docs/OPERATOR.md) | Production bind, auth, CORS, backup, deploy |

## Changelog

Release history: [`CHANGELOG.md`](CHANGELOG.md).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

Apache-2.0 — see [`LICENSE`](LICENSE).
