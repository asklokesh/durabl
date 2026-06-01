# durabl — M0 Fork-Feasibility Spike Findings

**Date:** 2026-06-01
**Spike:** `docs/phase0/spikes/m0-fork-feasibility/` (THROWAWAY — not production)
**Question under test:** *Can we build logical step-level trajectory fork + crash-safe
exactly-once replay over an existing step-journal engine's journal, WITHOUT
reimplementing the engine?*
**Gate type:** adversarial (real SIGKILL crash injection at every step boundary),
not happy-path.

---

## 0. VERDICT (read first)

**GATE PASSED — 10/10 adversarial gates green with real, runnable evidence.**
**M1 recommendation: GO** on the re-scoped wedge (replay/time-travel debugging +
logical fork over a neutral portable journal), built on **Restate** as primary
substrate, exactly as `validation-report.md` Decisions 1–3 picked.

The core risky assumption is **CONFIRMED, not killed**: logical step-level fork
and crash-safe exactly-once replay are buildable as a thin layer on top of
Restate's step-journal **with zero engine modification**. No engine internals
were forked or patched. The substrate did **not** fight us on the core mechanism.

One important nuance was discovered and resolved (see §3): exactly-once across a
crash that lands *between a side effect firing and the step result being
journaled* requires the **side effect to be idempotent** (deterministic
idempotency key). This is the industry-standard durable-execution contract, not
a Restate defect — and it is squarely the layer durabl owns.

---

## 1. What was built

Substrate: **Restate** — server + CLI `1.6.2` (native binaries, no Docker, no
cloud), TS SDK `1.14.4`. Durability = **step-journal** (`ctx.run`), never CRIU /
process snapshot.

A 3-step agent-style workflow (`src/service.ts`):

1. `step1-plan` — journaled step
2. `step2-tool_call` — **side-effecting tool call** (writes a row to a real
   SQLite effect log — the double-fire detector)
3. `step3-summarize` — journaled step; diverges per trajectory

Two cooperating layers:
- **Restate `ctx.run`** — engine at-least-once + crash replay from its journal.
- **Neutral portable journal** (`src/journal.ts`, plain `node:sqlite`) — the
  durabl artifact: structured, substrate-agnostic, JSONL-exportable per-step
  record, and the substrate for **logical fork** (`forkRun`: seed a new run from
  a source run's journal up to seq N, then diverge).
- **Idempotent effect sink** (`src/effects.ts`) — deterministic key
  `runId:stepName` under a `UNIQUE` index → end-to-end exactly-once.

Crash injection is a **real `process.kill(pid, 'SIGKILL')`** of the SDK service
mid-invocation — an uncatchable OS kill, NOT a mocked exception. Recovery is
driven entirely by Restate's journal + automatic invocation retry.

---

## 2. Evidence (verbatim from `spikes/.../gate-evidence.log`)

Full run: `npm run gate` → starts `restate-server`, starts the SDK service,
registers the deployment, runs all gates.

### 2.1 Crash injection at EVERY step boundary — exactly-once on restart

Each gate: SIGKILL the service at the named boundary, restart, let Restate
recover, then assert the SQLite effect log has **exactly one** row for the
side-effecting step (`effect_fires=1`).

```
[GATE PASS] crash@before:step1
  service_really_died=true effect_fires=1 (expect 1) journal_steps=[step1-plan,step2-tool_call,step3-summarize] result="answer[main]<<plan-for(crashy)|tool-result(effectId=1)|prompt=crashy>>"
[GATE PASS] crash@after:step1
  service_really_died=true effect_fires=1 (expect 1) journal_steps=[step1-plan,step2-tool_call,step3-summarize] ...
[GATE PASS] crash@before-effect:step2
  service_really_died=true effect_fires=1 (expect 1) journal_steps=[step1-plan,step2-tool_call,step3-summarize] ...
[GATE PASS] crash@after-effect:step2            <-- the dangerous window
  service_really_died=true effect_fires=1 (expect 1) journal_steps=[step1-plan,step2-tool_call,step3-summarize] ...
[GATE PASS] crash@after:step2
  service_really_died=true effect_fires=1 (expect 1) ...
[GATE PASS] crash@before:step3
  service_really_died=true effect_fires=1 (expect 1) ...
[GATE PASS] crash@after:step3
  service_really_died=true effect_fires=1 (expect 1) ...
```

Engine recovery is visible in the server log, e.g. for `after:step1`:

```
[CRASH] SIGKILL self at point=after:step1 run=... pid=2270
WARN restate_invoker_impl  Invocation error, retrying in 534ms ...
  error: unexpected error while reading the response body ... RT0010
INFO: Restate SDK started listening on 9080...
INFO [.../run][inv_...] Replaying invocation.
INFO [.../run][inv_...] Invocation completed successfully.
```

`service_really_died=true` is asserted by `process.kill(pid, 0)` returning
"no such process" before restart — i.e. the kill was real.

### 2.2 Fork correctness

Fork from seq N=2 (after the side-effecting tool call) onto a new trajectory.
Seeded steps replay from the journal; the prior side effect does **NOT** re-fire;
both trajectories are fully reconstructable; step3 diverges.

```
[GATE PASS] fork-correctness
  seeded=2(expect 2) src_effects=1(expect 1) fork_NEW_effects=0(expect 0)
  step2_output_identical=true diverged_answer=true parent_linked=true
  src_answer ="answer[main]   <<plan-for(original)|tool-result(effectId=9)|prompt=original>>"
  fork_answer="answer[what-if]<<plan-for(original)|tool-result(effectId=9)|prompt=diverged-prompt>>"
```

`fork_NEW_effects=0` is the key line: the forked run fired **zero** new side
effects for the seeded step; step1/step2 outputs are byte-identical to the source
(reused from the journal); only step3 diverged.

### 2.3 Concurrent-worker race

8 workers race on the SAME workflow key. Restate's run-once-per-key collapses them.

```
[GATE PASS] concurrent-workers
  workers=8 effect_fires=1(expect 1) journal_len=3(expect 3) distinct_answers=1(expect 1)
```

### 2.4 Replay determinism

Re-attaching to a completed run returns the same journaled step sequence and
output with no re-execution and no new side effect.

```
[GATE PASS] replay-divergence
  same_step_sequence=true same_answer=true effects(first=1,second=1; expect 1,1)
```

### 2.5 Summary

```
10/10 gates passed
VERDICT: GATE PASSED
```

---

## 3. What failed first, and what it teaches (honest report)

The gate did **not** pass on the first attempt. The `crash@after-effect:step2`
gate initially **FAILED with `effect_fires=2`** — a real double-fire:

```
[GATE FAIL] crash@after-effect:step2
  service_really_died=true effect_fires=2 (expect 1) ...
```

**Root cause:** the side effect (SQLite write) and the journal-commit of the step
result are not atomic (the classic dual-write problem). Crash sequence:
1. attempt 1: side effect fires (row written) → SIGKILL **before** the step
   result is journaled (in either Restate's log or the app journal);
2. on replay Restate correctly re-runs the un-journaled step → side effect fires
   **again** → 2 rows.

This is **expected** and is the well-known contract of every step-journal engine
(DBOS, Temporal, Restate, Google AX): the engine guarantees **at-least-once**
step execution across crashes; **exactly-once end-to-end requires the side effect
to be idempotent.**

**Fix (the layer durabl owns):** record the side effect under a **deterministic
idempotency key** (`runId:stepName`) with a `UNIQUE` constraint, so the
at-least-once re-fire dedups to one logical effect. After this one-line-of-design
change, `crash@after-effect:step2` and all 7 crash boundaries pass at
`effect_fires=1`.

**Implication for M1:** durabl's SDK shim must make step idempotency a
first-class, enforced part of the journal contract (auto-derive an idempotency
key per step; expose it to the effect sink). This is a *design requirement*, not
a blocker — and it is exactly the kind of correctness ergonomics a neutral
journal/replay layer should own on top of the substrate.

---

## 4. Substrate assessment (Restate)

- **Did Restate fight us?** No, on the core mechanism. Native binaries install
  cleanly via npm (arm64), no Docker required, single self-hostable server —
  matches the report's "light-medium, neutral" assessment. `ctx.run` durability,
  automatic invocation retry, and run-once-per-key workflow semantics all behaved
  exactly as documented under real SIGKILL.
- **Minor friction (spike-level, not blocking):**
  - SDK `/discover` does not answer a naive HTTP probe cleanly; readiness is best
    detected by a raw TCP connect + a successful `restate deployments register`.
  - Node 26's ecosystem broke `better-sqlite3` (native build failure); switched to
    the **built-in `node:sqlite`** — actually a *simplification* (zero native deps).
  - The data dir must not be deleted while a prior server is alive; the harness
    now kills stale processes first.
- **Engine modification required for fork?** **None.** Logical fork lives entirely
  in the application journal layer (`forkRun`) — confirming the report's Attack #1
  resolution and the M0 exit criterion.

---

## 5. Limits of this spike (do not over-claim)

- Single-node, single-machine. No distributed multi-partition failover, no network
  partitions, no clock skew tested.
- Concurrency gate races 8 in-process clients on one key; it does **not** test
  multiple independent worker hosts competing for the same partition.
- Steps are synthetic (no real LLM/tool latency). The exactly-once result depends
  on the side effect being idempotent — proven here with a UNIQUE-keyed sink; real
  tools (payments, emails) must supply real idempotency keys.
- The app journal and the Restate journal are two stores; M1 must define the
  source-of-truth + export contract precisely (see §3 implication).
- Throwaway code: not hardened, not benchmarked, no auth on the Restate ingress.

---

## STATUS / go-no-go

**STATUS: DONE**

**M1 go/no-go: GO.** Logical step-level fork + crash-safe exactly-once replay over
Restate's step-journal passes the adversarial gate (real SIGKILL at all 7 step
boundaries → exactly-once; correct fork with no side-effect re-fire; concurrent
race safe; deterministic replay) with **no engine modification**. Proceed to M1 on
the re-scoped wedge with Restate as primary substrate.

**Hard requirement carried into M1 (from §3):** the journal contract must enforce
per-step idempotency keys so end-to-end exactly-once holds for non-idempotent
real-world tools. This is a design item, not a feasibility blocker.

**Fallback (DBOS):** not needed. Restate did not fight the core mechanism, so the
DBOS/Postgres fallback in the build plan stays in reserve, unused. (DBOS would be
the move only if Restate's operational/ops story proves too heavy in M1 — not
indicated by this spike.)
