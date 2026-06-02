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

Phase 0 showed the **durable execution engine** wedge is closed (Google AX,
Temporal, Restate, and others). durabl targets what remains: **your history in
your infra**, demonstrable offline after export. Investor narrative and live
demo script: [`docs/FUNDING.md`](docs/FUNDING.md),
[`docs/DEMO-NARRATIVE.md`](docs/DEMO-NARRATIVE.md),
[`docs/RISKS.md`](docs/RISKS.md).

## Quickstart

**Prerequisites:** Node.js **>= 22.5.0** (uses built-in `node:sqlite`). macOS or
Linux recommended for the adversarial harness.

```bash
npm install
npm run build          # optional; demo/test build automatically
npm run demo           # scripted M1+M2 narrative (real SIGKILL + fork)
npm run ui             # replay UI → http://127.0.0.1:7878
```

One-liner:

```bash
./scripts/quickstart.sh
```

CLI (after `npm run build`):

```bash
npx durabl --help
npx durabl runs
npx durabl replay <runId>
npx durabl ui --from export.jsonl   # fully offline
```

**Verify (CI-style):**

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
| **M5** | HITL pause/resume across real restart | `npm run gate:m5` | ✅ 4/4 |

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

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `DURABL_DATA_DIR` | `$TMPDIR/durabl-m1` | Root for journal/effect/engine data |
| `DURABL_JOURNAL_DB` | `<root>/journal.db` | Portable step journal |
| `DURABL_EFFECT_DB` | `<root>/effects.db` | Idempotent effect sink |
| `DURABL_SERVICE_PORT` | `9080` | Restate SDK service port |
| `DURABL_RESTATE_INGRESS` | `http://localhost:8080` | Restate ingress |
| `DURABL_RESTATE_ADMIN` | `http://localhost:9070` | Restate admin |

No credentials are read or logged; paths and ports only.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

Apache-2.0 — see [`LICENSE`](LICENSE).
