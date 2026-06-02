# durabl — Completion checklist (M0–M5 + post-M5 tracks)

**Branch:** `feat/final-docs` · **Docs branch tip:** `c1d0aa0` · **Documented in build-status:** `5d58a92` · **Code baseline:** `077589c`

This checklist records what was **verified with real gates** vs **config-ready** (skipped or stubbed by design). Commit SHAs are from `git log` on the integration line that became `main`.

---

## Core milestones (M0–M5)

| ID | Deliverable | Gate / evidence | Verified | Tip commit (short) |
|----|-------------|-----------------|----------|------------------|
| **M0** | Fork + replay feasibility without engine mods | Spike under `docs/phase0/spikes/m0-fork-feasibility/` | ✅ Spike gates | `57ce9c3` |
| **M1** | Portable journal + structural exactly-once on Restate | `npm test` (== `npm run gate`) — 10/10 | ✅ Gated | `c9fad38` |
| **M2** | Logical trajectory fork + inspect APIs | `npm run gate:m2` — 6/6 | ✅ Gated | `53373fd` |
| **M3** | Replay / time-travel + offline export + UI | `npm run gate:m3` — 5/5 | ✅ Gated | `b90d239` |
| **M4** | Model + deploy neutrality (config-only) | `npm run gate:m4` — 4/4 | ✅ Gated | `f5a8df6` |
| **M5** | HITL pause/resume across real restart + export | `npm run gate:m5` — 5/5 (incl. web UI API resume G5) | ✅ Gated | `1cd52b1` |

**Full serial suite:** `npm run gate:all` → `scripts/run-all-gates.sh` (typecheck + M1 + M2–M5 + `gate:harden` + `gate:hitl-ui`). Evidence log may land on `feat/final-gates` as `docs/evidence/gate-all-*.log`.

Phase 0 narrative and re-scope: `4e795a3` (`docs/phase0/validation-report.md`, `build-plan.md`, PRD redline).

---

## Post-M5 parallel tracks (merged to main)

| Track | Scope | Merge / tip | Gate / entry | Verified |
|-------|--------|-------------|--------------|----------|
| **productize** | README, `package.json`, Docker compose profile, quickstart, CONTRIBUTING | `926dc2c` (merged `e3e5997`) | `compose:up`, `scripts/quickstart.sh` | ✅ Docs + packaging |
| **fundability** | Investor narrative grounded in Phase 0 | `5227c9f` (merged `9483a85`) | — (docs-only) | ✅ Docs |
| **harden** | Live provider gate, HTTP policy, second-substrate seam | `6da9f0a` (merged `70536ad`) | `npm run gate:harden` (3/3); `npm run gate:live` | ✅ Harden gated; live **config-ready** |
| **hitl-web-ui** | Paused list + resume in replay UI + HTTP API | `1e91a8a` / `7f0cf19` (merged `2c459b1`) | `npm run gate:hitl-ui` | ✅ Gated (offline + live G5 via M5) |

**Harness stabilization (post-merge, on main):** serialized gates via `/tmp/durabl-harness.lock`, attach-only M1 crash recovery, Restate lifecycle fixes — `0b3b097`, `911a19a`, `9a5fb34`, `d206675`, `0a376fd`.

---

## Verified vs config-ready

| Area | Status | Notes |
|------|--------|--------|
| Journal + idempotency + SIGKILL crash paths | **Verified** | M1–M5 gates; real `restate-server`, real SIGKILL, real SQLite sink |
| Logical fork / offline replay / HITL restart | **Verified** | M2–M5 + `gate:hitl-ui` |
| Provider switch (OpenAI / Anthropic) | **Verified** in gate | M4 uses test doubles; no network required for pass |
| **Live LLM calls** | **Config-ready** | `npm run gate:live` — **SKIP + exit 0** without `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` |
| **Docker deploy target (M4)** | **Config-ready** | Runs only when Docker daemon + local image present; otherwise CONFIG-READY-NOT-RUN |
| **DBOS second substrate** | **Config-ready** | `src/journal-source-dbos-stub.ts` + `gate:harden` H2 — interface only; see `docs/SECOND-SUBSTRATE.md` |
| **Offline HITL resume** | **By design** | `POST /api/hitl/input` → **503** without live Restate ingress (`docs/hitl-web-ui.md`) |

---

## Merge integration line (reference)

| Event | Commit (short) |
|-------|----------------|
| fundability → main | `9483a85` |
| harden → main | `70536ad` |
| productize → main | `e3e5997` |
| hitl-web-ui → main | `2c459b1` |
| Harness lock + lifecycle | `0b3b097` |
| build-status / HITL offline evidence | `18cb2fa` |

**After merging `feat/final-docs`:** `git rev-parse HEAD` → `c1d0aa0` (or squash). **Code integration before docs:** `077589cf571584007ecd2c17c9470712547322d8`

---

## Related docs

- [`build-status.md`](build-status.md) — gate matrix + reproduce commands
- [`FUNDING.md`](FUNDING.md) — investor narrative
- [`QUICKSTART.md`](QUICKSTART.md) — operator quickstart
- [`HARDENING.md`](HARDENING.md) · [`TEST-MATRIX.md`](TEST-MATRIX.md) — hardening tracks
