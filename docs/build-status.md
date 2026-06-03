# durabl — Build Status (M0–M5 + parallel tracks)

**Date:** 2026-06-03 · **Substrate:** Restate `1.6.2` (server/CLI) + SDK `1.14.4`
(step-journal, single self-hostable binary, no Docker/cloud needed) · **Runtime:**
Node 26 (built-in `node:sqlite`, zero native deps) · **License:** Apache-2.0 ·

**main HEAD:** `5e71af9` — **`gate:all`:** exit **0**, **ALL GATES PASSED** — authoritative [`docs/evidence/gate-all-20260603-010109.log`](evidence/gate-all-20260603-010109.log) (also [`gate-all-20260602-234458.log`](evidence/gate-all-20260602-234458.log)). Partial SIGKILL (not primary): [`gate-all-20260603-011624.log`](evidence/gate-all-20260603-011624.log) exit **137**.

The product (per Phase 0 re-scope, `docs/phase0/validation-report.md`): a
**neutral, portable, self-hostable agent execution journal** with **replay /
time-travel**, **logical trajectory fork**, **model/deploy neutrality**, and
**human-in-the-loop pause/resume** — built as a thin layer on a proven
step-journal substrate, never reimplementing the durable engine.

> Every milestone has a single-command, CI-suitable gate with REAL evidence
> (real `restate-server`, real SIGKILL on crash paths, real process restart,
> assertions read from the real SQLite effect sink + journal — no mocks on the
> crash/restart paths). Each gate exits 0 on pass.

**STATUS: GO** — all gates pass when run serially on a clean machine (`enterHarnessGate` file lock at `/tmp/durabl-harness.lock`). Run one gate at a time if a prior run was SIGKILL'd without releasing the lock.

---

## Milestone table

| Milestone | Scope | Gate | Status | Reproduce | Evidence |
|---|---|---|---|---|---|
| **M0** | Feasibility spike: logical fork + replay over a substrate journal with **no engine modification** | spike gates | ✅ GO | `docs/phase0/spikes/m0-fork-feasibility/` (spike) | `docs/phase0/validation-report.md`, `build-plan.md` |
| **M1** | Portable step journal + **structural per-step idempotency** (branded `IdempotencyKey`, required by the effect sink) + crash-safe **exactly-once** on Restate | crash@every boundary (incl. dual-write window), concurrent-worker race, fork-no-refire, replay determinism | ✅ **10/10** | `npm test` (`== npm run gate`) | `docs/m1-slice.md`, `docs/m1-evidence/` |
| **M2** | **Logical trajectory fork** as a product: `seedFork`/`forkAndRun` + read-only inspection (`inspect`/`lineage`/`tree`/`diff`) + lineage-in-export | fork-no-refire, multi-level fork, concurrent forks, **crash-during-fork** exactly-once | ✅ **6/6** | `npm run gate:m2` | `docs/m2-trajectory-branching.md`, `docs/m2-evidence/` |
| **M3** | **Replay / time-travel** read surface over a `JournalSource`; **offline reconstruction from a portable export with the substrate killed**; local web UI | reconstruct-matches-reality, **offline-from-export (substrate killed)**, time-travel, fork-tree+diff, UI-API-offline | ✅ **5/5** | `npm run gate:m3` | `docs/m3-observability-replay.md`, `docs/m3-evidence/` |
| **M4** | **Neutrality**: same agent across **2 model providers** and **2 deploy targets**, **config-only, no code change**; journal portability across both | provider-switch (no code change), durability-under-switch (SIGKILL), deploy-target switch, journal-portability offline | ✅ **4/4** | `npm run gate:m4` | `docs/m4-neutrality.md`, `docs/m4-evidence/` |
| **M5** | **HITL pause/resume** across a **real process restart** + export + **web UI API resume** | pause→exit→restart→resume→complete, crash-during-resume, double-submit, export+offline-replay, **hitl-web-ui-api-resume** | ✅ **5/5** | `npm run gate:m5` | `docs/m5-hitl-export.md`, `docs/m5-evidence/` |
| **Full suite** | Serial M1–M5 + harden + hitl-ui + `gate:dbos-skip` (shared `DURABL_DATA_DIR`, teardown between gates) | typecheck + all milestone/extension gates | ✅ **PASS** exit 0 (2026-06-03) | `npm run gate:all` | [`docs/evidence/gate-all-20260603-010109.log`](evidence/gate-all-20260603-010109.log) (`ALL GATES PASSED`; partial [`011624`](evidence/gate-all-20260603-011624.log) exit 137) |

**Run core milestones (each exits 0 on pass):**

```bash
npm test          # M1 — 10/10
npm run gate:m2   # M2 — 6/6
npm run gate:m3   # M3 — 5/5
npm run gate:m4   # M4 — 4/4
npm run gate:m5   # M5 — 5/5
npm run gate:all  # full serial suite (M1–M5 + harden + hitl-ui)
```

---

## Post-M5 (merged to main)

Post-M5 work shipped as four parallel branches, then harness hardening on `main`. None of these replace M0–M5 gates; they extend packaging, narrative, hardening, and operator UX.

| Track | Branch | Tip (short) | Scope | Gate / entry | Docs |
|---|---|---|---|---|---|
| **productize** | `feat/productize` | `926dc2c` | README polish, `package.json` metadata, `docker-compose`, `CONTRIBUTING`, quickstart | `npm run compose:up`, `docs/QUICKSTART.md`, `scripts/quickstart.sh` | `README.md`, `CONTRIBUTING.md`, `docs/QUICKSTART.md` |
| **fundability** | `feat/fundability` | `5227c9f` | Investor narrative grounded in Phase 0 evidence | — (docs-only) | `docs/FUNDING.md`, `docs/RISKS.md`, `docs/DEMO-NARRATIVE.md` |
| **harden** | `feat/harden` | `6da9f0a` | Live provider gate (skip without keys), HTTP retry policy, second-substrate seam | `npm run gate:live` (skip exit 0), `npm run gate:harden` | `docs/HARDENING.md`, `docs/TEST-MATRIX.md`, `docs/SECOND-SUBSTRATE.md` |
| **hitl-web-ui** | `feat/hitl-web-ui` | `1e91a8a` | HITL paused list + resume in replay web UI + HTTP API | `npm run gate:hitl-ui` (`gate:hitl-web` alias) | `docs/hitl-web-ui.md`, `docs/hitl-ui-evidence/` |

**Merge commits on main:** `9483a85` (fundability), `70536ad` (harden), `e3e5997` (productize), `2c459b1` (hitl-web-ui).

**Harness stabilization (on main after merges):** `911a19a` (registration + M5 G5 fold), `9a5fb34` / `d206675` / `0a376fd` (crash-gate recovery), `0b3b097` (exclusive `/tmp/durabl-harness.lock` + reliable Restate lifecycle). M1 crash phase 2 uses **attach only** (no second `invokeAsync`).

**Extension gates (verified 2026-06-02):**

```bash
npm run gate:live      # SKIP + exit 0 when no API keys
npm run gate:harden    # 3/3 PASS
npm run gate:hitl-ui   # G2 offline readonly (+ M5 G5 when run via full gate:m5)
```

Checklist with commit SHAs and verified vs config-ready: [`docs/COMPLETION.md`](COMPLETION.md).

---

## Harness notes (2026-06-02)

- Shared `startAndRegisterService()` with port cleanup + deployment register retries.
- M1 crash recovery uses **attach only** on phase 2 (no second `invokeAsync`).
- Gates acquire `/tmp/durabl-harness.lock`; summary prints before lock release to avoid SIGKILL during heavy `harnessTeardown` on the gate process.

## What's real vs config-ready

- **Real, gated, mock-free:** the journal + idempotency contract; exactly-once
  across real SIGKILL at every boundary (M1); logical fork with no side-effect
  re-fire (M2); offline replay from a portable export with the substrate genuinely
  killed (M3); provider/target switching by config with durability preserved (M4);
  HITL durable pause + resume across a **real** process/substrate restart with
  exactly-once preserved (M5); HITL resume via web UI HTTP API in live mode
  (`gate:hitl-ui` / M5 G5).
- **Config-ready (honest):** real OpenAI/Anthropic calls activate only when
  `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` are present; `gate:live` **skips** when no keys are set;
  the Docker deploy target runs only when a Docker daemon + local image are present
  (the gate reports CONFIG-READY-NOT-RUN rather than pulling over the network).
- **DBOS adapter:** `src/journal-source-dbos-stub.ts` types the future `JournalSource` plug-in; not a working DBOS integration (`docs/SECOND-SUBSTRATE.md`).
- **Offline HITL (by design):** exported bundles list paused runs; `POST /api/hitl/input` returns **503** without live Restate ingress (`docs/hitl-web-ui.md`).

---

## Release boundary (verified vs config-ready vs not planned)

| Item | Status | Notes |
|------|--------|--------|
| M0–M5 + `gate:harden` H1/H2/H3 + `gate:hitl-ui` G2 + `gate:dbos-skip` | **VERIFIED** | `npm run gate:all` @ `263374286168dafced4ddcd40e3bd04b536103f1`; log [`gate-all-20260603-010109.log`](evidence/gate-all-20260603-010109.log) |
| H3 live LLM (`gate:harden` / `gate:live`) | **CONFIG-READY** | SKIP exit 0 with no API keys; real keys required for live provider exercise |
| M4 Docker deploy target | **CONFIG-READY** | Skipped when Docker daemon/image absent |
| **DBOS second substrate** | **NOT-PLANNED** | Interface stub + H2 gate only — not a working DBOS integration |
| **Offline HITL live submit** | **NOT-PLANNED** | Export lists paused runs; resume requires live Restate (`503` offline) |
| **Python SDK** | **NOT-PLANNED** | Stub/docs only; TS first ([`PYTHON-SDK.md`](PYTHON-SDK.md)) |
| Reimplementing durable engine / CRIU fork | **NOT-PLANNED** | Phase 0 rejection — step-journal fork only |
| Managed hosted control plane | **NOT-PLANNED** | Narrative only ([`FUNDING.md`](FUNDING.md)) |
