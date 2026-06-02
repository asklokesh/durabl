# durabl — Build Plan M0–M5 (Phase 0 revision)

## Status as of 2026-06-02

**M0–M5 are done** — all core gates pass on a clean machine; see [`docs/build-status.md`](../build-status.md) for reproduce commands and evidence paths.

| Planned (this doc) | Shipped (main) | Note |
|---|---|---|
| M2 — Replay / time-travel UI | **M3** — replay UI + offline export | Order **swapped** vs plan below: fork shipped before the read-only replay surface. |
| M3 — Logical trajectory fork | **M2** — `seedFork` / lineage / diff | Same scope, earlier milestone number. |
| M4 — Python SDK + DBOS parity | **M4** — model/deploy **neutrality** (TS) | Python SDK and second-substrate **parity gates deferred** — see [`docs/SECOND-SUBSTRATE.md`](../SECOND-SUBSTRATE.md), [`docs/HARDENING.md`](../HARDENING.md). |
| M5 — Managed layer + grow-down | **M5** — HITL pause/resume + export (+ web UI API on main) | Managed control plane still **roadmap**, not shipped. |

**Deferred (explicit):** Python fast-follow and DBOS/Postgres substrate adapter remain design targets from Phase 0; shipping evidence is Restate-only TS. Do not infer Python or DBOS from milestone labels in the sections below — use the table above and `build-status.md`.

---

Date: 2026-06-01. Revised against the resolved decisions in `validation-report.md`
and the redline in `prd-redline.md`. The original plan assumed building a durable
execution engine; this is rejected. The plan below targets the re-scoped wedge:
**replay-debugging / time-travel over a neutral, portable, self-hostable agent
execution journal, built on an existing step-journal substrate.**

Guiding constraints (from Phase 0):
- Step-journal mechanism only (no snapshot/CRIU). 
- Build on Restate (TS + self-hostable + neutral) primary; DBOS (Postgres) fallback.
- TypeScript-first, Python fast-follow.
- Logical step-level fork, never process snapshot.
- Solo + Claude Code. If any milestone requires distsys-level correctness work on the
  engine itself, STOP — that means the wedge slipped back to the engine.

---

## M0 — Feasibility spike (HARD prerequisite to M1) — ~1 week

Goal: kill/confirm the one risky assumption — *can we build logical step-level
trajectory fork + replay over an existing engine's journal without reimplementing
the engine?*

- Spike (throwaway, under `docs/phase0/spikes/`): instrument a trivial agent loop
  (LLM step + tool step) on **Restate** (and a parallel mini-spike on DBOS/Postgres),
  capture the journal, and prototype: (a) read/export the step journal to a neutral
  format; (b) seed a *new* run from another run's journal up to step N (logical fork);
  (c) replay/time-travel render of the step sequence.
- Exit criteria: fork + replay demonstrated over the substrate journal with NO engine
  modification. If it requires forking/patching the engine internals → NO-GO, escalate.

## M1 — Neutral journal capture + export (TS) — ~3–4 weeks

- TS SDK shim wrapping an agent loop on the chosen substrate; record each
  LLM/tool/HITL step as a structured, serializable journal entry (inputs, outputs,
  timing, model/provider-neutral metadata).
- **Portable journal format** (the moat): schema-versioned, substrate-agnostic export
  (JSONL/SQLite). "Your journal, in your infra, exportable."
- Self-host story: runs entirely in the customer's process/infra; no data leaves.

## M2 — Replay / time-travel UI (the demoable wedge) — ~4–6 weeks

- Web UI over the journal: step-by-step trajectory view, pause/inspect, diff between
  steps, surface tool I/O and LLM messages. (Compete on neutrality + self-host vs
  LangSmith/AgentOps/Braintrust.)
- Read-only first (lowest correctness risk). This is the v0 product to put in front of users.

## M3 — Logical trajectory fork — ~3–4 weeks

- Implement step-level fork: create a new run seeded from journal step N, diverge
  (different prompt/tool/model). Mirror Google `ax fork` ergonomics but neutral +
  portable across substrates. "What if I'd called search instead of grep at step 7?"

## M4 — Python SDK + second substrate parity — ~3–4 weeks

- Python SDK (LangGraph / OpenAI-Agents / Pydantic-AI loops).
- Validate journal format parity across Restate and DBOS substrates (proves neutrality
  claim is real, not marketing).

## M5 — Managed layer + grow-down to durability/portability — ~ongoing

- Optional managed control plane (hosted UI, retention, sharing) on top of OSS core;
  OSS journal/SDK stays self-hostable (GTM: OSS core + managed layer, unchanged).
- Grow-down: offer durability/exactly-once *guarantees* surfaced from the substrate +
  cross-substrate journal portability as the v1 expansion — the genuinely-open sliver.

---

### What was removed vs the original §5 plan
- Removed: "build durable execution engine core," any snapshot/CRIU milestone, any
  milestone whose correctness depends on reimplementing crash/exactly-once semantics.
  Those are consumed from the substrate, not built (Decision 2/4).

### Kill-switches (re-evaluate the whole plan if hit)
- M0 spike shows fork needs engine internals → wedge invalid, reconsider.
- A funded neutral self-hosted replay+fork competitor emerges (re-scan each milestone;
  Langfuse/Phoenix moving into fork/durable-replay is the signal to watch).
- Google AX adds neutral cross-substrate portability + a polished replay UI → the
  remaining sliver closes; pivot.
