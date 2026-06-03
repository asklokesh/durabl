# durabl — Completion checklist (M0–M5 + final-wave)

**Branch:** `main` · **HEAD:** `8a2b197` · **Gate log:** [`docs/evidence/gate-all-20260603-010109.log`](evidence/gate-all-20260603-010109.log) (`gate:all` exit **0**, **ALL GATES PASSED**)[^gate-partial] · **Gate live:** [`docs/evidence/gate-live-20260603-gpt4o-mini.log`](evidence/gate-live-20260603-gpt4o-mini.log) (`gate:live` PASS, `DURABL_OPENROUTER_MODEL=openai/gpt-4o-mini`) · **Repo:** https://github.com/asklokesh/durabl

[^gate-partial]: Non-authoritative partial run [`gate-all-20260603-011624.log`](evidence/gate-all-20260603-011624.log) — exit **137** (runner SIGKILL ~25s). Prior full pass also [`gate-all-20260602-234458.log`](evidence/gate-all-20260602-234458.log).

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
| **ui-fork-tree** | Nested fork lineage + breadcrumb from `/api/tree` | `25a5538` (cherry-pick) | `gate:m3` fork-tree checks | ✅ Web-only |
| **ui-dark-mode** | Light/dark theme + system preference toggle | `0536735` (cherry-pick) | manual / `capture:ui` | ✅ Web-only |

Operator guide for replay UI (fork tree, diff, HITL, offline matrix): [`UI.md`](UI.md).

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

## Backend / HTTP server (`src/server.ts`)

**Route map:** [`BACKEND.md`](BACKEND.md)

| Branch | Tip SHA | Scope |
|--------|---------|--------|
| `feat/backend-health` | `e7b3c9f313070d82b1cd84642d9554c38732014f` | `/health`, `/ready`, `/metrics` (JSON liveness; Prometheus text on `/metrics`) |
| `feat/backend-security` | `3d6b0dde88d1e99126eecc6a8942793d0a574123` | CORS, headers, `DURABL_API_KEY` |
| `feat/backend-runs-api` | `d2ef28f07641f4cbe7c793264c1509e2eb5b201a` | Paginated `GET /api/runs` |
| `feat/backend-fork-api` | `13606e9265b3cf05b2018045c5c2531857871f71` | Fork REST + inspect |
| `feat/backend-migrations` | `3c0b57c282be2341760ae8ef4b4cd9fd94ddce77` | SQLite journal migrations |
| `feat/backend-otel` | `177cade9b35dab6a1dd7ef61458e47024752710c` | Optional OTEL hooks |
| `feat/backend-lifecycle` | `588357b4de6821583083da5b3281824f32b33222` | Env validation, SIGTERM |
| `feat/backend-auth` | `8a3519370091c77cf4e4a9ce86f7f8da1038824e` | API auth gate |
| `feat/backend-ratelimit` | `f09d9535f8122cf372ffc10d558c9622f5e7ca69` | HITL POST rate limit |
| `feat/backend-api-tests` | `7f79005007823a0e7809d084ae3271935535a353` | `npm run test:api` |
| `feat/backend-ws` | `b9eeb122a746563713f1001ad0ba2b2b4ba72b80` | WS runs feed |

**Skipped:** `feat/backend-logging` (wrong tree; structured logging landed via other backend branches).

**Land on `main`:** `561add8e694c69b3a05c00555891bb9c66d0f20f` (`0f0f36c` initial merge + `c5b8c7e` route/probe fix + docs).

**Gates (backend touch):** `npm run typecheck`, `npm run test:api`, `npm run gate:m5`, `npm run gate:hitl-ui`.

---

## Verified vs config-ready

| Area | Status | Notes |
|------|--------|--------|
| Journal + idempotency + SIGKILL crash paths | **Verified** | M1–M5 gates; real `restate-server`, real SIGKILL, real SQLite sink |
| Logical fork / offline replay / HITL restart | **Verified** | M2–M5 + `gate:hitl-ui` |
| Provider switch (OpenAI / Anthropic) | **Verified** in gate | M4 uses test doubles; no network required for pass |
| **Live LLM calls (H3)** | **CONFIG-READY** | `gate:live` / H3: SKIP exit 0 without keys; needs real OpenAI/Anthropic keys to exercise |
| **Docker deploy target (M4)** | **CONFIG-READY** | `gate:m4` CONFIG-READY-NOT-RUN when Docker daemon/image absent |
| **DBOS second substrate** | **NOT-PLANNED** (stub only) | `journal-source-dbos-stub.ts` + H2 stub gate — not a working DBOS product |
| **Offline HITL live submit** | **NOT-PLANNED** (by design) | `POST /api/hitl/input` → **503** without live Restate ingress |
| **Python SDK** | **NOT-PLANNED** (stub) | `docs/PYTHON-SDK.md` only; TS ships first |

---

## UX/UI + integrations merge queue (2026-06-02)

All branches below are **ancestors of `main`** at HEAD `5f88326`. Serial merge into `/private/tmp/durabl-merge-main` (integration `main`).

| Branch | Scope | Merged |
|--------|--------|--------|
| `feat/ui-a11y` (`2acd804`) | Replay UI a11y roles, settings, lineage | ✅ (prior) |
| `feat/ui-e2e` | Playwright `test:e2e` | ✅ `0e8f197` |
| `feat/ui-hitl-polish` | HITL paused list + submit UX | ✅ `046ab07` |
| `feat/ui-connection-banner` | Connection pill + offline tooltip | ✅ `de7a088` + `50efc3f` (connectionLabel) |
| `feat/ux-cli` | CLI colors, spinner, error hints | ✅ `2ee4820` |
| `feat/ux-errors` | (same tip as hitl-polish) | ✅ via hitl-polish |
| `feat/ux-timeline` | Step labels, durations, provider badges | ✅ `0881c06` |
| `feat/ux-keyboard` | Keyboard shortcuts | ✅ (prior) |
| `feat/ux-onboarding` | First-visit tour | ✅ (prior) |
| `feat/ux-help` | Help drawer | ✅ (prior) |
| `feat/ux-quickstart` | Quickstart in UI | ✅ (prior) |
| `feat/ux-demo` | Interactive demo script | ✅ (prior) |
| `feat/ux-toasts` | HITL toasts, copy run ID | ✅ (prior) |
| `feat/integ-index` | Integrations hub + K8s/gh-action docs | ✅ `e735c4e` |
| `feat/ui-routing` | Hash routes `#/run/:id/step/:n` | ✅ `34872c2` |
| `feat/integ-dbos` | DBOS wiring doc + `gate:dbos-skip` | ✅ `46a84bd` |
| `feat/integ-google-ax` | Google Agent Executor mapping | ✅ `5c9f50c` |
| `feat/integ-mcp` | MCP tool stub (`durabl/mcp`) | ✅ `24cd5e7` |
| `feat/integ-vercel-ai` | Vercel AI SDK mapping (DEFERRED) | ✅ `d67e13f` |
| `feat/final-cli` | CLI release polish | ✅ (prior) |

**Branch tips not cherry-picked (already on main under other SHAs):** `feat/backend-logging`, `feat/backend-ratelimit`, `feat/backend-security`, `feat/ui-run-list`, `feat/hitl-web-ui`, `feat/ux-export`.

---

## gate:all status

| Field | Value |
|-------|--------|
| **Integration HEAD** | `263374286168dafced4ddcd40e3bd04b536103f1` |
| **Canonical log** | [`docs/evidence/gate-all-20260603-010109.log`](evidence/gate-all-20260603-010109.log) |
| **Verdict** | `ALL GATES PASSED` (typecheck + M1–M5 + harden + hitl-ui + dbos-skip) |
| **Exit code** | `0` |
| Reproduce | `rm -f /tmp/durabl-harness.lock && export DURABL_DATA_DIR=/tmp/durabl-gate-$$ && npm run gate:all 2>&1 \| tee docs/evidence/gate-all-$(date +%Y%m%d-%H%M%S).log` |

**H3 live-providers (`gate:harden`):** **VERIFIED** skip path — no `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` → `[SKIP] live-providers-gate` exit 0. Placeholder keys are **not** valid; they force real HTTP and fail. Real keys required for a full H3 pass (`npm run gate:live`).

---

## Related docs

- [`UI.md`](UI.md) — replay UI: fork tree, diff, HITL, offline matrix
- [`build-status.md`](build-status.md) — gate matrix + reproduce commands
- [`FUNDING.md`](FUNDING.md) · [`QUICKSTART.md`](QUICKSTART.md)
- [`HARDENING.md`](HARDENING.md) · [`TEST-MATRIX.md`](TEST-MATRIX.md)
