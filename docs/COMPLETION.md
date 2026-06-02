# durabl — Completion checklist (M0–M5 + final-wave)

**Branch:** `main` · **HEAD:** `9688dcb1c100d2c506bf3d354584d1b5f92532b4` · **Gate log:** `docs/evidence/gate-all-20260602.log` (`ALL GATES PASSED`, harness tip `a33b693`)

This checklist records what was **verified with real gates** vs **config-ready** (skipped or stubbed by design).

---

## Core milestones (M0–M5)

| ID | Deliverable | Gate / evidence | Verified | Tip commit (short) |
|----|-------------|-----------------|----------|-------------------|
| **M0** | Fork + replay feasibility without engine mods | Spike under `docs/phase0/spikes/m0-fork-feasibility/` | ✅ Spike gates | `57ce9c3` |
| **M1** | Portable journal + structural exactly-once on Restate | `npm test` (== `npm run gate`) — 10/10 | ✅ Gated | `c9fad38` |
| **M2** | Logical trajectory fork + inspect APIs | `npm run gate:m2` — 6/6 | ✅ Gated | `53373fd` |
| **M3** | Replay / time-travel + offline export + UI | `npm run gate:m3` — 5/5 | ✅ Gated | `b90d239` |
| **M4** | Model + deploy neutrality (config-only) | `npm run gate:m4` — 4/4 | ✅ Gated | `f5a8df6` |
| **M5** | HITL pause/resume across real restart + export | `npm run gate:m5` — 5/5 (incl. web UI API resume G5) | ✅ Gated | `1cd52b1` |

**Full serial suite:** `npm run gate:all` → `scripts/run-all-gates.sh` (typecheck + M1 + M2–M5 + `gate:harden` + `gate:hitl-ui`).

Phase 0 narrative and re-scope: `4e795a3` (`docs/phase0/validation-report.md`, `build-plan.md`, PRD redline).

---

## Post-M5 parallel tracks (merged to main)

| Track | Scope | Merge / tip | Gate / entry | Verified |
|-------|--------|-------------|--------------|----------|
| **productize** | README, `package.json`, Docker compose profile, quickstart, CONTRIBUTING | `926dc2c` (merged `e3e5997`) | `compose:up`, `scripts/quickstart.sh` | ✅ Docs + packaging |
| **fundability** | Investor narrative grounded in Phase 0 | `5227c9f` (merged `9483a85`) | — (docs-only) | ✅ Docs |
| **harden** | Live provider gate, HTTP policy, second-substrate seam | `6da9f0a` (merged `70536ad`) | `npm run gate:harden` (3/3); `npm run gate:live` | ✅ Harden gated; live **config-ready** |
| **hitl-web-ui** | Paused list + resume in replay UI + HTTP API | `1e91a8a` / `7f0cf19` (merged `2c459b1`) | `npm run gate:hitl-ui` | ✅ Gated (offline + live G5 via M5) |

**Harness stabilization:** serialized gates via `/tmp/durabl-harness.lock`, attach-only M1 crash recovery, Restate lifecycle fixes — `0b3b097`, `911a19a`, `9a5fb34`, `d206675`, `0a376fd`, `a33b693` (gate:all teardown preserves active gate children).

---

## Final-wave branches (requested merge set)

All listed branches are **ancestors of integration `main`** (verified 2026-06-02). Merge order: docs/templates first, code/fixtures/CI last.

| Branch | Scope (summary) | Merged | Notes |
|--------|-----------------|--------|-------|
| `feat/final-adr` | Architecture decision records | ✅ | docs |
| `feat/final-docs` | Doc index / polish | ✅ | docs |
| `feat/final-docs-sync` | Docs sync (`docs-sync`) | ✅ | docs |
| `feat/final-changelog` | CHANGELOG | ✅ | docs |
| `feat/final-arch` | Architecture docs (`arch`) | ✅ | docs |
| `feat/final-templates` | Issue/PR templates | ✅ | templates |
| `feat/final-screenshots` | UI evidence (`screenshots`) | ✅ | docs/assets |
| `feat/final-env` | `.env.example`, env docs (`env`) | ✅ | config docs |
| `feat/final-worktrees` | Worktree hygiene scripts (`worktrees`) | ✅ | DX |
| `feat/final-hygiene` | Repo hygiene (`hygiene`) | ✅ | DX |
| `feat/final-python` | Python SDK stub / docs | ✅ | config-ready |
| `feat/final-devcontainer` | Dev container | ✅ | DX |
| `feat/final-smoke` | `scripts/smoke-quickstart.sh` | ✅ | CI entry |
| `feat/final-npm` | npm pack / publish scripts | ✅ | packaging |
| `feat/final-api` | HTTP API docs + tests surface | ✅ | code |
| `feat/final-integrations` | Integration guides | ✅ | docs |
| `feat/final-fixtures` | Offline JSONL fixtures (`fixtures`) | ✅ | test/fixtures |
| `feat/final-security` | HTTP security headers, API key, rate limit (`security`) | ✅ | code |
| `feat/final-ci` | CI workflow (`ci`) | ✅ | last |
| `feat/final-gates` | `run-all-gates.sh` fix + gate evidence | ✅ | **do not revert** — adds descendant-safe teardown |
| `feat/final-release` | Release checklist (`release`) | ✅ | docs |

**Also landed on main (not in original poll list):** `feat/final-onepager`, `feat/final-openapi`, `feat/final-examples`, `feat/final-makefile`, `feat/final-schema`, `feat/final-docker`, `feat/final-roadmap`, `feat/final-cli`, `feat/final-lint`, `feat/final-typedoc`, `feat/final-faq`.

**Intentionally excluded:** stale `feat/final-gates` tip that would revert integration (superseded by `a33b693` fix merge).

---

## Verified vs config-ready

| Area | Status | Notes |
|------|--------|--------|
| Journal + idempotency + SIGKILL crash paths | **Verified** | M1–M5 gates; real `restate-server`, real SIGKILL, real SQLite sink |
| Logical fork / offline replay / HITL restart | **Verified** | M2–M5 + `gate:hitl-ui` |
| Provider switch (OpenAI / Anthropic) | **Verified** in gate | M4 uses test doubles; no network required for pass |
| **Live LLM calls** | **Config-ready** | `npm run gate:live` — **SKIP + exit 0** without API keys |
| **Docker deploy target (M4)** | **Config-ready** | CONFIG-READY-NOT-RUN without local Docker image |
| **DBOS second substrate** | **Config-ready** | `src/journal-source-dbos-stub.ts` + `gate:harden` H2 |
| **Offline HITL resume** | **By design** | `POST /api/hitl/input` → **503** without live Restate ingress |
| **Python SDK** | **Config-ready** | `docs/PYTHON-SDK.md` stub only |

---

## gate:all status

| Field | Value |
|-------|--------|
| Integration HEAD (post ux-settings merge) | `72c0d19` |
| Gate log HEAD (serial run) | `41a1b74` |
| Gate fix commit | `a33b693` |
| **Canonical log** | [`docs/evidence/gate-all-20260602.log`](evidence/gate-all-20260602.log) |
| **Verdict in log** | `ALL GATES PASSED` (typecheck + M1–M5 + harden + hitl-ui) |
| Reproduce | `export DURABL_DATA_DIR=/tmp/durabl-gate-$$ && npm run gate:all 2>&1 \| tee docs/evidence/gate-all-$(date +%Y%m%d).log` |

**Coordinator note (2026-06-02):** Fresh `gate:all` reruns on a busy integration worktree hit **exit 137 (SIGKILL)** during M1 and/or **typecheck failures** from concurrent `feat/backend-*` / `feat/ux-*` merges into `src/server.ts`. Quiesce parallel merges, reset `src/server.ts` + `src/logging.ts` to the `b411caa` pair (or resolve conflicts), then rerun `npm run typecheck && npm run gate:all`.

---

## Related docs

- [`build-status.md`](build-status.md) — gate matrix + reproduce commands
- [`FUNDING.md`](FUNDING.md) · [`QUICKSTART.md`](QUICKSTART.md)
- [`HARDENING.md`](HARDENING.md) · [`TEST-MATRIX.md`](TEST-MATRIX.md)
