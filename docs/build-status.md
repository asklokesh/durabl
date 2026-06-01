# durabl — Build Status (M0–M5)

**Date:** 2026-06-01 · **Substrate:** Restate `1.6.2` (server/CLI) + SDK `1.14.4`
(step-journal, single self-hostable binary, no Docker/cloud needed) · **Runtime:**
Node 26 (built-in `node:sqlite`, zero native deps) · **License:** Apache-2.0.

The product (per Phase 0 re-scope, `docs/phase0/validation-report.md`): a
**neutral, portable, self-hostable agent execution journal** with **replay /
time-travel**, **logical trajectory fork**, **model/deploy neutrality**, and
**human-in-the-loop pause/resume** — built as a thin layer on a proven
step-journal substrate, never reimplementing the durable engine.

> Every milestone has a single-command, CI-suitable gate with REAL evidence
> (real `restate-server`, real SIGKILL on crash paths, real process restart,
> assertions read from the real SQLite effect sink + journal — no mocks on the
> crash/restart paths). Each gate exits 0 on pass.

---

## Milestone table

| Milestone | Scope | Gate | Status | Reproduce | Evidence |
|---|---|---|---|---|---|
| **M0** | Feasibility spike: logical fork + replay over a substrate journal with **no engine modification** | spike gates | ✅ GO | `docs/phase0/spikes/m0-fork-feasibility/` (spike) | `docs/phase0/validation-report.md`, `build-plan.md` |
| **M1** | Portable step journal + **structural per-step idempotency** (branded `IdempotencyKey`, required by the effect sink) + crash-safe **exactly-once** on Restate | crash@every boundary (incl. dual-write window), concurrent-worker race, fork-no-refire, replay determinism | ✅ **10/10** | `npm test` (`== npm run gate`) | `docs/m1-slice.md`, `docs/m1-evidence/` |
| **M2** | **Logical trajectory fork** as a product: `seedFork`/`forkAndRun` + read-only inspection (`inspect`/`lineage`/`tree`/`diff`) + lineage-in-export | fork-no-refire, multi-level fork, concurrent forks, **crash-during-fork** exactly-once | ✅ **6/6** | `npm run gate:m2` | `docs/m2-trajectory-branching.md`, `docs/m2-evidence/` |
| **M3** | **Replay / time-travel** read surface over a `JournalSource`; **offline reconstruction from a portable export with the substrate killed**; local web UI | reconstruct-matches-reality, **offline-from-export (substrate killed)**, time-travel, fork-tree+diff, UI-API-offline | ✅ **5/5** | `npm run gate:m3` | `docs/m3-observability-replay.md`, `docs/m3-evidence/` |
| **M4** | **Neutrality**: same agent across **2 model providers** and **2 deploy targets**, **config-only, no code change**; journal portability across both | provider-switch (no code change), durability-under-switch (SIGKILL), deploy-target switch, journal-portability offline | ✅ **4/4** | `npm run gate:m4` | `docs/m4-neutrality.md`, `docs/m4-evidence/` |
| **M5** | **HITL pause/resume** across a **real process restart** (durable, journal-not-memory) + **full-journal export** of a HITL run | pause→exit→restart→resume→complete, crash-during-resume, double-submit idempotent, export+offline-replay | ✅ **4/4** | `npm run gate:m5` | `docs/m5-hitl-export.md`, `docs/m5-evidence/` |

**Run everything (each exits 0 on pass):**

```bash
npm test          # M1 — 10/10
npm run gate:m2   # M2 — 6/6
npm run gate:m3   # M3 — 5/5
npm run gate:m4   # M4 — 4/4
npm run gate:m5   # M5 — 4/4  (HITL + state export, the final milestone)
```

---

## What's real vs config-ready

- **Real, gated, mock-free:** the journal + idempotency contract; exactly-once
  across real SIGKILL at every boundary (M1); logical fork with no side-effect
  re-fire (M2); offline replay from a portable export with the substrate genuinely
  killed (M3); provider/target switching by config with durability preserved (M4);
  HITL durable pause + resume across a **real** process/substrate restart with
  exactly-once preserved (M5).
- **Config-ready (honest):** real OpenAI/Anthropic calls activate only when
  `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` are present (else a deterministic,
  CI-safe simulated provider runs); the Docker deploy target runs only when a
  Docker daemon + local image are present (the gate reports CONFIG-READY-NOT-RUN
  rather than pulling over the network or faking it). See `docs/m4-neutrality.md`.
- **Deferred (documented):** the M3 web UI does not yet surface a pause/resume
  affordance (HITL resume is CLI-only) — deferred to avoid the M3 browse-daemon
  deadlock for zero gate value (`docs/m5-hitl-export.md` §6).

## Single-machine envelope (applies to all milestones)

Single-node, single-host. No multi-partition / network-partition / clock-skew
testing — those are substrate concerns, deliberately consumed from Restate, not
reimplemented (Phase 0 Decisions 1–4). "Process restart" means a real OS process
death + a fresh process on the same host over the substrate's persisted state.
