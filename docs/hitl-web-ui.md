# HITL web UI — pause / resume affordance

**Branch:** `feat/hitl-web-ui`  
**Builds on:** M3 replay UI + M5 HITL journal semantics (`hitl_pause` / `hitl_input`).

The M3 web UI now surfaces runs **paused awaiting human input** and, in **live mode**, submits decisions through the same Restate path as `durabl hitl-input` (`HitlAgentRun` / `provideInput`).

---

## Live mode

```bash
npm run build
# Terminal A: substrate + service (see docs/m5-hitl-export.md)
npm run service
# register deployment, then:
node dist/cli.js hitl-run my-run --prompt "ship it?"
npm run ui
# Open http://127.0.0.1:7878 — sidebar "Awaiting human input", submit form on the run.
```

### API (live journal + Restate ingress)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/hitl/paused` | List journal-derived paused runs |
| GET | `/api/hitl/status?runId=` | `paused` \| `resumed` \| `none` |
| POST | `/api/hitl/input` | Body `{ "runId", "decision" }` → `provideInput` (idempotent) |

`/api/runs` entries include `hitlState`. `/api/health` reports `live` and `hitlSubmitEnabled`.

Double-submit is safe: duplicate `provideInput` returns `accepted: false`; journal already has `hitl_input` → API returns 200 with `state: "resumed"`.

---

## Offline mode (`durabl ui --from export.jsonl`)

Paused state is **read from the export**: a run with `hitl_pause` and no `hitl_input` appears under **Awaiting human input** and in replay.

**Submit is not available offline.** `POST /api/hitl/input` returns **503** with an explicit message — resolving the durable promise requires live Restate ingress, not the JSONL file alone.

Completed HITL exports (pause + input) show `hitlState: "resumed"` only; use a paused-in-progress export or live mode to exercise the form.

---

## Gate (no browse daemon)

```bash
npm run gate:hitl-ui
```

Fetch-only tests in `src/harness/run-hitl-ui-gate.ts` (same pattern as M3 G5). UI screenshots, if needed: `npm run capture:ui` in a **separate** process.

---

## Design note (M3 deadlock)

The replay server does **not** drive gstack browse on its event loop. HITL resume uses `fetch` to Restate ingress from the API handler only in live mode.
