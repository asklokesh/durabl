# durabl M1 — Thin Vertical Slice

**Date:** 2026-06-01
**Status:** first PRODUCTION milestone (not throwaway). Realizes the M0 GO.
**Substrate:** Restate (server/CLI `1.6.2`, TS SDK `1.14.4`) — step-journal, single
self-hostable binary, no Docker, no cloud. Logical fork only; never CRIU/snapshot.
**Runtime:** Node 26 (built-in `node:sqlite`, zero native deps).

**Decision record:** [ADR 001 — Portable journal, idempotency key, no CRIU](adr/001-portable-journal.md) (canonical *why*; this doc is the *how* + gate evidence).

This document describes the M1 architecture, the idempotency contract, how the
adversarial gate is verified, and pastes the **real** output of the crash harness.

---

## 1. Architecture

M1 is a 3-step agent-style workflow on Restate, persisting to a portable step
journal with a structurally-enforced per-step idempotency contract. Two
durability layers cooperate:

1. **Restate `ctx.run(...)`** — engine-level crash durability + automatic
   invocation retry. The body of a `ctx.run` step executes **at-least-once**
   across a real process crash; Restate replays completed steps from its own log.
2. **durabl `recordStep(...)`** — the neutral/portable journal AND the application
   short-circuit: an already-recorded `(runId, seq)` is replayed from the journal
   without re-running its producer (this is also what makes a *forked/seeded* step
   not re-fire). It derives the deterministic idempotency key and passes it to the
   step.

The side-effecting step (step 2) can only fire its effect through `fireEffect`,
which **requires** the derived `IdempotencyKey`. The effect sink dedups on that
key, giving end-to-end **exactly-once**.

### Module separation (the durable assets)

```
idempotency.ts  →  branded IdempotencyKey; deriveIdempotencyKey(runId, stepName)
step-model.ts   →  neutral JournalEntry / RunMeta / step types (schema v1)
journal.ts      →  recordStep (idempotent), trajectory, exportJsonl, forkRun
effect-sink.ts  →  fireEffect(idemKey REQUIRED) — exactly-once boundary
workflow.ts     →  3-step Restate workflow wiring the above together
```

`workflow.ts` never touches SQLite directly. `effect-sink.ts` cannot be invoked
without an `IdempotencyKey`. The journal + idempotency contract are
substrate-detail-free and are what M2 (replay UI) and M3 (fork) build on.

### Portable / neutral journal

Each journal entry is a schema-versioned, substrate-agnostic record:

```ts
interface JournalEntry {
  schema: 1;
  runId: string;
  seq: number;
  stepName: string;
  kind: "plan" | "tool_call" | "summarize";
  idemKey: IdempotencyKey;   // runId:stepName
  output: unknown;           // JSON
  sideEffect: boolean;
  seededFrom: string | null; // set when copied in by a fork
  recordedAt: string;
}
```

`exportJsonl(runId)` emits one `JournalEntry` per line — no Restate/engine fields
leak. This is the "your journal, in your infra, exportable" surface and the seed
substrate for logical fork (`forkRun`), which copies entries `seq <= N` into a new
run and lets it diverge past `N`.

---

## 2. The idempotency contract (core correctness)

The M0 spike caught a **real double-fire**: a crash landing between "side effect
fires" and "step result is journaled" causes the engine to re-run the un-journaled
step on replay → the effect fires twice. This is the well-known contract of every
step-journal engine (Restate, DBOS, Temporal, Google AX): the engine guarantees
**at-least-once**; **exactly-once end-to-end requires the side effect to be
idempotent under a deterministic key.**

durabl makes this **structural, not optional**:

1. `IdempotencyKey` is a **branded type**. It can only be produced by
   `deriveIdempotencyKey(runId, stepName)` → `` `${runId}:${stepName}` ``. You
   cannot pass a raw string where a key is required.
2. `recordStep` derives the key and **passes it to the step producer**, so the
   only key a step can use is the canonical one.
3. `fireEffect` **requires** an `IdempotencyKey` in its signature — there is no
   string-keyed escape hatch. A side effect cannot be fired without one.
4. The effect sink has a `UNIQUE` index on `idem_key`; the journal has a
   `UNIQUE (run_id, idem_key)` index. The re-fire after a crash deterministically
   computes the **same** key and is collapsed to one logical effect.

Determinism is the linchpin: the key is a pure function of stable step identity
(`runId` is the durable workflow key, `stepName` is the fixed logical name), so
the same logical step computes the same key on every replay.

---

## 3. How the gate is verified (adversarial, real evidence)

Single command, CI-suitable:

```bash
npm test     # == npm run gate
```

It builds, starts a local `restate-server`, then runs:

- **Crash boundaries (7):** SIGKILL the SDK service process at every step boundary,
  restart, let Restate recover, and assert the side effect fired **exactly once**,
  read from the real idempotent effect sink. Includes the dangerous
  `after-effect:step2` window (effect fired, journal not yet committed).
  - The crash is a **real, uncatchable** `process.kill(pid, 'SIGKILL')` — not a
    mocked throw. `service_really_died=true` is asserted via `process.kill(pid, 0)`
    returning "no such process" before restart.
- **Concurrent-worker race:** 8 workers race on the same run key; assert exactly
  one effect, one journal trajectory, no corruption.
- **Fork correctness:** fork from seq 2 (after the side-effecting step); the seeded
  step does **not** re-fire (`fork_NEW_effects=0`); step 3 diverges; lineage linked.
- **Replay determinism:** re-attaching a completed run returns the identical step
  sequence/output with no new side effect.

No mocks on the crash path. All assertions read the real SQLite effect log +
journal.

---

## 4. REAL gate output (pasted verbatim)

Full log: [`m1-evidence/gate-evidence.log`](m1-evidence/gate-evidence.log).
Run on 2026-06-01, Node 26, Restate `1.6.2` / SDK `1.14.4`, `npm test` exit code 0.

### 4.1 Crash injection at EVERY step boundary → exactly-once on restart

Each line is the gate's assertion read from the real effect sink. `effect_fires=1`
at every boundary, including the dangerous after-effect window:

```
[GATE PASS] crash@before:step1
  service_really_died=true effect_fires=1 (expect 1) journal_steps=[step1-plan,step2-tool_call,step3-summarize] result="answer[main]<<plan-for(crashy)|tool-result(effectId=13)|prompt=crashy>>"
[GATE PASS] crash@after:step1
  service_really_died=true effect_fires=1 (expect 1) journal_steps=[step1-plan,step2-tool_call,step3-summarize] result="answer[main]<<plan-for(crashy)|tool-result(effectId=14)|prompt=crashy>>"
[GATE PASS] crash@before-effect:step2
  service_really_died=true effect_fires=1 (expect 1) journal_steps=[step1-plan,step2-tool_call,step3-summarize] result="answer[main]<<plan-for(crashy)|tool-result(effectId=15)|prompt=crashy>>"
[GATE PASS] crash@after-effect:step2            <-- the dangerous dual-write window
  service_really_died=true effect_fires=1 (expect 1) journal_steps=[step1-plan,step2-tool_call,step3-summarize] result="answer[main]<<plan-for(crashy)|tool-result(effectId=16)|prompt=crashy>>"
[GATE PASS] crash@after:step2
  service_really_died=true effect_fires=1 (expect 1) journal_steps=[step1-plan,step2-tool_call,step3-summarize] result="answer[main]<<plan-for(crashy)|tool-result(effectId=18)|prompt=crashy>>"
[GATE PASS] crash@before:step3
  service_really_died=true effect_fires=1 (expect 1) journal_steps=[step1-plan,step2-tool_call,step3-summarize] result="answer[main]<<plan-for(crashy)|tool-result(effectId=19)|prompt=crashy>>"
[GATE PASS] crash@after:step3
  service_really_died=true effect_fires=1 (expect 1) journal_steps=[step1-plan,step2-tool_call,step3-summarize] result="answer[main]<<plan-for(crashy)|tool-result(effectId=20)|prompt=crashy>>"
```

The real SIGKILL + engine recovery is visible in the server log, e.g. for the
`before:step1` case:

```
[restate] INFO: Restate SDK started listening on 9080...
[restate][AgentRun/crash-before_step1-.../run][inv_...] INFO: Starting invocation.
[CRASH] SIGKILL self at point=before:step1 run=crash-before_step1-... pid=9449
WARN restate_invoker_impl  Invocation error, retrying in 536ms ...
  error: client error (SendRequest) ... connection reset  (RT0010)
WARN restate_invoker_impl  Invocation error, retrying in 1s 271ms ...
  error: unexpected closed request stream while trying to write a message  (RT0010)
[restate] INFO: Restate SDK started listening on 9080...
[restate][AgentRun/crash-before_step1-.../run][inv_...] INFO: Starting invocation.
[restate][AgentRun/crash-before_step1-.../run][inv_...] INFO: Invocation completed successfully.
```

> Note on `effectId` values: the effect sink uses `AUTOINCREMENT` ids that never
> reuse a value, so ids advance across gates (and across harness runs). The
> correctness assertion is the **count** per `(runId, stepName)` = `effect_fires=1`,
> not the id value. The gap (e.g. 16→18) reflects a single deduped re-fire still
> resolving to one logical row.

### 4.2 Concurrent-worker race

```
[GATE PASS] concurrent-workers
  workers=8 effect_fires=1(expect 1) journal_len=3(expect 3) distinct_answers=1(expect 1)
```

### 4.3 Fork correctness (M3 foundation)

```
[GATE PASS] fork-correctness
  seeded=2(expect 2) src_effects=1(expect 1) fork_NEW_effects=0(expect 0) step2_output_identical=true diverged_answer=true parent_linked=true src_answer="answer[main]<<plan-for(original)|tool-result(effectId=22)|prompt=original>>" fork_answer="answer[what-if]<<plan-for(original)|tool-result(effectId=22)|prompt=diverged-prompt>>"
```

`fork_NEW_effects=0` is the key line: the forked run fired **zero** new side
effects for the seeded step (replayed from journal); only step 3 diverged.

### 4.4 Replay determinism

```
[GATE PASS] replay-determinism
  same_step_sequence=true same_answer=true effects(first=1,second=1; expect 1,1)
```

### 4.5 Summary

```
================ M1 GATE SUMMARY ================
PASS  crash@before:step1
PASS  crash@after:step1
PASS  crash@before-effect:step2
PASS  crash@after-effect:step2
PASS  crash@after:step2
PASS  crash@before:step3
PASS  crash@after:step3
PASS  concurrent-workers
PASS  fork-correctness
PASS  replay-determinism
------------------------------------------------
10/10 gates passed
VERDICT: GATE PASSED
================================================
```

`npm test` exits 0. The hardened teardown reaps the engine/service children so the
process exits cleanly in CI.

---

## 5. Limits (do not over-claim)

- Single-node, single-machine. No distributed multi-partition failover, network
  partitions, or clock skew tested (out of M1 scope; substrate concern).
- The concurrency gate races 8 in-process clients on one key; it does not test
  multiple independent worker hosts competing for the same partition.
- Steps are synthetic (no real LLM/tool latency). Exactly-once depends on the side
  effect being idempotent — proven here with a deterministic-keyed sink. Real tools
  (payments, email) must route through this idempotency contract, which is exactly
  what M1 makes structural.
- The app journal and the Restate journal are two stores. M1's journal is the
  portable export surface; the substrate provides crash durability. They agree
  because each step's output is produced once inside the durable step and recorded
  under the same deterministic key (§1, §2).
- This is the vertical slice + its gate only. The replay UI (M2) and the fork CLI
  ergonomics (M3) are deliberately NOT built; the journal is structured so both are
  natural next steps (`exportJsonl`, `forkRun`, `seededFrom`/lineage already exist).

---

## 6. STATUS / M2 go-no-go

**STATUS: DONE.** The M1 adversarial gate passes 10/10 with real SIGKILL evidence:
exactly-once at every step boundary (including the after-effect dual-write window),
a clean 8-worker concurrent race, correct logical fork with no side-effect re-fire,
and deterministic replay. The per-step idempotency contract is structural
(branded `IdempotencyKey`, required by the effect sink, enforced by UNIQUE indexes).

**M2 (trajectory branching / fork) go/no-go: GO.** The hard correctness work is
done and validated: the journal already supports `forkRun` (seed seq ≤ N, diverge),
records `seededFrom` lineage and `parentRun`/`forkedAtSeq` metadata, and the
fork-correctness gate proves seeded steps do not re-fire. M2 builds fork ergonomics
and the replay/time-travel surface on top of a journal that is already neutral,
portable, and exactly-once-safe — no engine modification required.
