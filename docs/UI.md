# durabl replay web UI

**Entry:** `npm run ui` (alias: `durabl ui`) → `http://127.0.0.1:7878`  
**Source:** `web/index.html`, `web/app.css`, `web/app.js` — vanilla JS, zero deps, copied to `dist/web/` at build.

The UI is a **read-only replay surface** over a `JournalSource` (live SQLite journal or imported JSONL export). It does not talk to Restate directly except when the server is in **live HITL mode** (`POST /api/hitl/input`).

---

## Layout

| Region | Purpose |
|--------|---------|
| **Header** | Source label (`/api/health`), live vs imported pill, light/dark theme toggle |
| **Left — Runs & fork tree** | Root runs, nested lineage from `GET /api/tree`, breadcrumb path highlight |
| **Center — Timeline** | Step list, time-travel scrubber (`stateAt`), step detail JSON |
| **Right — Diff / HITL** | Trajectory diff (side-by-side or inline), paused-run list + submit form (live only) |

Mobile breakpoints (`@media` ≤720 / 640 / 400px) stack the three-column layout and tighten timeline/HITL controls for narrow viewports.

---

## Replay & time-travel

```bash
npm run build
durabl ui                          # live journal (SQLite)
durabl ui --from export.jsonl      # offline import
```

| API | UI use |
|-----|--------|
| `GET /api/runs` | Run list + roots |
| `GET /api/replay?runId=` | Full reconstructed run |
| `GET /api/state-at?runId=&n=` | Time-travel scrubber |
| `GET /api/diff?runA=&runB=` | Trajectory diff panel |

**Diff view:** toggle side-by-side vs inline; first-divergence highlight and jump-to-divergence. Preference stored in `localStorage` (`durabl.diffViewMode`).

---

## Fork tree

Fork lineage is rendered from **`GET /api/tree?runId=`** (root run):

- Nested list + SVG fork twigs per child run
- Lineage breadcrumb (`lineagePath`) highlights the path from root → selected run
- Click any node to `selectRun` and refresh timeline/diff

See M2/M3 docs for the underlying `forkTreeFrom` / `JournalSource` semantics.

---

## HITL (human-in-the-loop)

Builds on M5 pause/resume journal semantics. See also [`hitl-web-ui.md`](hitl-web-ui.md).

| API | Live | Offline import |
|-----|------|------------------|
| `GET /api/hitl/paused` | ✅ | ✅ (from export) |
| `GET /api/hitl/status?runId=` | ✅ | ✅ |
| `POST /api/hitl/input` | ✅ (Restate ingress) | ✅ **offline queue** (`hitlSubmitMode: offline-queue`) |
| `POST /api/hitl/flush` | ✅ (replay queue → ingress) | **503** (live only) |

Live mode: sidebar **Awaiting human input**, decision form calls the same path as `durabl hitl-input`. Double-submit is idempotent.

---

## Theme (light / dark)

- Default follows `prefers-color-scheme`
- Header toggle sets `data-theme="light"|"dark"` on `<html>`
- Choice persisted in `localStorage` (`durabl.theme`); `"system"` clears override

---

## Offline vs live matrix

| Capability | Live journal (`durabl ui`) | Offline import (`durabl ui --from …`) |
|------------|---------------------------|---------------------------------------|
| Run list, fork tree, timeline | ✅ | ✅ |
| Time-travel / step detail | ✅ | ✅ |
| Trajectory diff | ✅ | ✅ |
| Paused runs visible | ✅ | ✅ (if export contains `hitl_pause` without `hitl_input`) |
| HITL submit (queue locally) | ✅ | ✅ |
| HITL resume on Restate | ✅ | ❌ (flush in live mode) |
| `/api/health` `live` | `true` | `false`; origin `imported:…` |
| Source pill | green (live) | amber (offline) |

**Proof:** M3 gate G3 (substrate killed, replay from export); M5 G4 (HITL export offline); `npm run gate:hitl-ui` G2 (offline queue submit).

---

## Gates & screenshots

```bash
npm run gate:m3        # replay + offline-from-export + UI-API-offline (incl. fork tree + diff)
npm run gate:hitl-ui   # offline paused read-only (G2); live resume via M5 G5
npm run capture:ui     # headless screenshots (separate process; not on server event loop)
```

Evidence: `docs/m3-evidence/`, `docs/hitl-ui-evidence/`.

---

## UI merge commits (reference)

| Feature | Branch / commit |
|---------|-----------------|
| Trajectory diff (side/inline) | on main (M3/hitl-web-ui line) |
| Fork lineage tree | `feat/ui-fork-tree` `25a5538` |
| Light/dark theme | `feat/ui-dark-mode` `0536735` |
| Responsive breakpoints | on main (M3); `feat/ui-responsive` `b657317` if not already present |

Do **not** merge unrelated backend/OpenAPI branches when integrating UI-only work — cherry-pick `web/*` commits only.
