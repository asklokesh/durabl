# durabl — 5-minute quickstart

**Time:** ~5 minutes after a one-time install (~2–3 min on a warm machine).  
**Requires:** Node **≥ 22.5**, `npm`, and ports **8080** / **9070** / **9080** free (Restate demo).

Get from clone → scripted crash/fork demo → optional M1 gate, replay UI, HITL, and Docker.

---

## Fast path (recommended)

After install (section 1), run the repo smoke script:

```bash
bash scripts/quickstart.sh
```

**Time:** ~45–90s (build is cached after the first `npm run build`).

**You should see:**

```text
==> durabl quickstart
    Node v22.x.x (requires >= 22.5)
==> npm run demo
...
VERDICT: DEMO PASSED — this is the single demo that proves the company.

Done. Next:
  npm run ui          # replay UI (live journal)
  npm test            # M1 adversarial gate
  npm run gate:m2     # M2 fork gate
  durabl --help       # CLI
```

Exit code **0**. If the demo ends with `DEMO FAILED` or `DEMO ERROR`, see [DEMO-NARRATIVE.md](./DEMO-NARRATIVE.md) and ensure no other `restate-server` / `dist/service.js` processes are holding the ports.

---

## 1. Install (~2–3 min first time)

**v0.1.0:** releases ship as a GitHub Actions **tarball**, not npmjs.org. Pick one path:

**From source (contributors):**

```bash
git clone <your-fork> durabl && cd durabl
cp .env.example .env   # optional: uncomment DURABL_* vars you need
npm install
npm run build
```

**From a release tarball (operators / consumers):**

```bash
# Download durabl-0.1.0.tgz from the Actions run for tag v0.1.0 (see RELEASING.md)
npm install /path/to/durabl-0.1.0.tgz
durabl --help
```

Details: [RELEASING.md](./RELEASING.md). Production settings: [OPERATOR.md](./OPERATOR.md).

See [`.env.example`](../.env.example) for `DURABL_*` knobs (data dir, Restate ports, providers, UI). The template has comments only — no secrets.

**You should see** (build):

```text
> durabl@0.1.0 build
> tsc -p tsconfig.json && node scripts/copy-web.mjs

[build] copied web/ → dist/web
```

---

## 2. Scripted demo (Acts 1–5) — same as `scripts/quickstart.sh`

```bash
npm run demo
# or: bash scripts/quickstart.sh   # skips redundant install when node_modules exists
```

**Time:** ~45–90s.

Narrative: real `restate-server`, real **SIGKILL** mid-run, resume without double-firing a side effect, inspect the journal, fork an alternate path, diff trajectories. Details: [DEMO-NARRATIVE.md](./DEMO-NARRATIVE.md).

**You should see** (Act 2 — the proof point):

```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ACT 2 — Resume from the exact step. Exactly-once preserved.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  → run recovered and completed: "answer[main]<<..."
  → side-effect fire count (read from REAL effect sink): 1 (expect 1)
  → EXACTLY-ONCE across crash: YES ✓
```

**You should see** (finale):

```text
DEMO RESULT
Crash → exact-step resume, no double-fire:       PASS
Open trajectory, fork from earlier step, explore: PASS

VERDICT: DEMO PASSED — this is the single demo that proves the company.
```

Copy a `demo-*` run id from the log for section 4 (`export-bundle` / UI).

---

## 3. Prove the journal (M1) (~35–45s)

```bash
npm test
```

**You should see:**

```text
================ M1 GATE SUMMARY ================
PASS  crash@before:step1
...
PASS  replay-determinism
------------------------------------------------
10/10 gates passed
VERDICT: GATE PASSED
================================================
```

Exit code **0**. This is stricter than the scripted demo alone (more crash points + fork/replay gates).

---

## 4. Replay UI (M3) (~1 min)

```bash
# After a demo, gate, or manual run populated the journal:
npm run ui
# open http://127.0.0.1:7878
```

**You should see:** a local server on **7878**; the UI lists runs from the journal (e.g. `demo-*` from section 2).

Offline from an export (no Restate running):

```bash
# Checked-in sample bundle (no live server / no prior demo run):
npm run ui -- --from docs/m3-evidence/portable-bundle.jsonl
# open http://127.0.0.1:7878 — amber "imported" pill; HITL submit disabled (view-only)

# Your own export (prefer export-bundle for fork-tree lineage):
node dist/cli.js export-bundle <rootRunId> > run-bundle.jsonl
npm run ui -- --from run-bundle.jsonl
```

Single-run export (no fork tree bundle): `export <runId> > run.jsonl` then `ui --from run.jsonl`.

Replace `<rootRunId>` with a run id from `npm run demo` (e.g. `demo-1780373547547`).

---

## 5. HITL pause/resume (M5, CLI) (~2–3 min)

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

**You should see:** `paused` lists `demo-1` while waiting; after `hitl-input`, the run completes and disappears from the paused set.

---

## 6. Docker demo stack (optional) (~5–10 min first build)

Services use the **`docker-demo`** Compose profile (`docker-compose.yml`). Without `--profile docker-demo`, no containers start.

Restate runs a healthcheck on admin `GET /health`; the **durabl** service waits
for `restate` to be healthy before starting.

```bash

docker compose --profile docker-demo config    # validate YAML (~5s)
docker compose --profile docker-demo up --build
# or: npm run compose:up

docker compose --profile docker-demo ps        # expect restate (healthy)

docker compose --profile docker-demo exec restate \
  restate deployments register http://durabl:9080
```

Set `DURABL_RESTATE_INGRESS=http://localhost:8080` when invoking from the host.

**You should see** (`ps`): `restate` **healthy**, `durabl` **running**.

Stop with `docker compose --profile docker-demo down`.

---

## Release verification (maintainers)

| Check | Command | Typical result |
|-------|---------|----------------|
| Build + pack | `npm run build && npm pack --dry-run` | **PASS** |
| Typecheck | `bash scripts/verify-release.sh` | **PASS** (typecheck only) |
| Quickstart smoke | `bash scripts/quickstart.sh` (allow ~2 min) | **PASS** (exit 0, `VERDICT: DEMO PASSED`) |
| Full gates | `npm run gate:all` | run before merge (~several min) |

If quickstart fails with `registerDeployment` / `connection refused` on **9080**, kill stray `restate-server` and `node dist/service.js` processes and retry.

---

## Next

- Demo script (talk track): [DEMO-NARRATIVE.md](./DEMO-NARRATIVE.md)
- Milestone evidence: [build-status.md](./build-status.md)
- Architecture: [m1-slice.md](./m1-slice.md), [m3-observability-replay.md](./m3-observability-replay.md), [m5-hitl-export.md](./m5-hitl-export.md)
- Live LLM smoke (optional keys): [DEVELOPMENT.md](./DEVELOPMENT.md#live-provider-gate-gatelive)
