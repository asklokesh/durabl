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

```bash
docker compose up --build
docker compose exec restate restate deployments register http://durabl:9080
```

Set `DURABL_RESTATE_INGRESS=http://localhost:8080` when invoking from the host.

## Next

- Milestone evidence: `docs/build-status.md`
- Architecture: `docs/m1-slice.md`, `docs/m3-observability-replay.md`, `docs/m5-hitl-export.md`
