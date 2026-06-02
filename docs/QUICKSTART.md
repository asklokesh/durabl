# durabl — 5-minute quickstart

Get from clone to a passing M1 gate, then skim replay and HITL surfaces.

## 1. Install

```bash
git clone <your-fork> durabl && cd durabl
npm install
npm run build
```

## 2. Prove the journal (M1)

```bash
npm test
```

Expect exit `0` and adversarial crash/fork/replay checks in the log.

## 3. Replay UI (M3)

```bash
# After a gate or manual run populated the journal:
npm run ui
# open http://127.0.0.1:7878
```

Offline from an export (no Restate running):

```bash
node dist/cli.js export-bundle <rootRunId> > run.jsonl
node dist/cli.js ui --from run.jsonl
```

## 4. HITL pause/resume (M5, CLI)

Terminal A — substrate + service:

```bash
npm run service
# separate shell: restate-server + register deployment (see harness/restate-control.ts)
```

Terminal B — human loop:

```bash
node dist/cli.js hitl-run demo-1 --prompt "ship?"
node dist/cli.js paused
node dist/cli.js hitl-input demo-1 --decision "APPROVED"
```

## 5. Docker demo stack (optional)

Services are gated behind the **`docker-demo`** Compose profile (see `docker-compose.yml`).
Without `--profile docker-demo`, no containers start.

```bash
docker compose --profile docker-demo up --build
# or: npm run compose:up

docker compose --profile docker-demo exec restate \
  restate deployments register http://durabl:9080
```

Set `DURABL_RESTATE_INGRESS=http://localhost:8080` when invoking from the host.
Stop with `docker compose --profile docker-demo down`.

## Release verification (maintainers)

| Check | Command | Result (`feat/final-release`) |
|-------|---------|-------------------------------|
| Build + pack | `npm run build && npm pack --dry-run` | **PASS** |
| Typecheck | `bash scripts/verify-release.sh` | **PASS** (typecheck only) |
| Quickstart smoke | `timeout 300 bash scripts/quickstart.sh` | **FAIL** (exit 3) — demo `registerDeployment` after SIGKILL restart: `META0003` / `localhost:9080` connection refused |
| Full gates | `npm run gate:all` | not run here (slow); run before merge |

## Next

- Milestone evidence: `docs/build-status.md`
- Architecture: `docs/m1-slice.md`, `docs/m3-observability-replay.md`, `docs/m5-hitl-export.md`
