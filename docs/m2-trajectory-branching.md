# durabl M2 — Trajectory Branching (the differentiator + v0 proof)

**Date:** 2026-06-01
**Status:** PRODUCTION milestone. The fundable/acquirable proof per build-plan §5.
**Builds on:** M1 (durable core: portable step journal + structural per-step
idempotency + crash-safe exactly-once on Restate). M2 does **not** rewrite the
durable core — it promotes the M1 `forkRun` primitive into a product capability
and adds a read-only trajectory inspection surface.
**Substrate:** Restate (step-journal, single self-hostable binary). Logical
step-level fork only; never CRIU/snapshot (Phase 0 Decisions 1/3, Attacks #1/#3).

> Re-scoped wedge (validation-report STATUS): a **neutral, self-hostable
> replay/time-travel layer over a portable execution journal**, with **logical
> step-level fork** as the differentiator the crowded observability market
> (LangSmith/AgentOps/Braintrust/Langfuse) does not own. M2 is that fork
> capability, proven adversarially.

---

## 1. What M2 adds

| Concern | M1 (foundation) | M2 (this milestone) |
|---|---|---|
| Fork primitive | `forkRun(seq ≤ N)` journal copy, exercised once in the M1 gate | `fork.ts`: validated `forkAndRun`/`seedFork` **product API** + `durabl fork` CLI |
| Inspection | `trajectory()`, `exportJsonl()` | `inspect.ts`: `inspectRun`, `lineage`, `listForks`, `forkTree`, `diffTrajectories` + `durabl inspect/diff/tree/list-forks` CLI |
| Portability of lineage | journal entries only | `exportJsonl(runId, includeMeta=true)` — **fork lineage travels with the export** (tagged `run_meta` line) |
| Adversarial gate | crash/concurrency/fork/replay (10/10) | fork-no-refire, multi-level fork, concurrent forks, **crash-during-fork exactly-once** (6/6) |
| Narrative | — | `npm run demo`: kill mid-run → exact resume, no double-fire → open trajectory → fork from earlier step → explore |

New source on top of `src/`:

```
src/fork.ts      → fork product API: validateForkPlan / seedFork / forkAndRun (ergonomics + validation)
src/inspect.ts   → read-only inspection: inspectRun / lineage / listForks / forkTree / diffTrajectories
src/cli.ts       → `durabl` CLI: run, fork, inspect, list-forks, tree, diff, export, runs
src/harness/run-m2-gate.ts → adversarial M2 gate (real restate-server + real SIGKILL)
src/harness/demo.ts        → the single scripted end-to-end demo
```

The durable core (`journal.ts`, `idempotency.ts`, `effect-sink.ts`, `workflow.ts`)
is unchanged except for **additive** read helpers (`childRuns`, `allRunIds`) and a
**backward-compatible** `exportJsonl` overload (`includeMeta`). M1's gate still
passes 10/10 (no regression).

---

## 2. The fork model — and how it REUSES the idempotency contract

A fork is two operations:

1. **SEED (pure, journal-only)** — `seedFork` → `forkRun`: copy the source run's
   journal entries `seq ≤ N` into a new `runId`, each marked
   `seededFrom = source`, and record lineage in `run_meta`
   (`parentRun`, `forkedAtSeq = N`). Transactional (all-or-nothing).

2. **DIVERGE (substrate)** — invoke the new run with a **new decision/prompt**.
   The reference workflow runs the same control flow, but `recordStep` finds the
   seeded `(runId, seq)` entries already present and **short-circuits them — the
   producer never runs, so the seeded step's side effect never re-fires.** Only
   steps after `N` actually execute and journal fresh outputs.

**The no-refire guarantee is the M1 idempotency contract reused verbatim, not a
new mechanism and not a weakening of it:**

- A seeded step is replayed from the journal by `recordStep` (same code path as
  crash-replay), so its `fireEffect` body is never entered on the fork.
- If a fork instead executes the side-effecting step *itself* (fork point `N`
  *before* the effect, e.g. fork from seq 1), that step derives its idempotency
  key from the **new** `runId` (`deriveIdempotencyKey(newRunId, stepName)`), so it
  is a genuinely distinct logical effect — fired exactly once on the forked
  trajectory, deduped across crashes by the same `UNIQUE(idem_key)` boundary.

So: seeded effects fire **zero** additional times; a fork's own post-divergence
effects fire **exactly once**, even under SIGKILL. The forked path's idem keys are
namespaced by `runId`, which is what prevents cross-contamination between a parent
and its forks (and between concurrent forks).

```
source:  [1 plan]──[2 tool_call (effect E_src)]──[3 summarize "main"]
                         │ fork @N=2 (seed seq≤2; E_src in the seeded prefix)
                         ▼
fork:    [1 plan]──[2 tool_call  SEEDED, replayed, NO re-fire ]──[3 summarize "what-if"]   ← diverges at seq 3

source:  [1 plan]──[2 tool_call (effect E_src)]──[3 summarize "main"]
              │ fork @N=1 (seed seq≤1 only)
              ▼
fork:    [1 plan SEEDED]──[2 tool_call  NEW effect E_fork, key=fork:step2 ]──[3 summarize]  ← fork fires its OWN effect once
```

### Inspection / diff API (read-only)

Everything is reconstructable from the neutral journal alone — both a run and any
fork of it, independently, even after export. Nothing here invokes the substrate
or mutates state.

- `inspectRun(runId)` → steps + lineage meta + effects fired *by this run* +
  `seededSeqs` + `divergedAtSeq` + direct forks.
- `lineage(runId)` → divergence chain root→…→run (cycle-guarded).
- `listForks(runId)` / `forkTree(rootId)` → direct children / full descendant tree.
- `diffTrajectories(a, b)` → per-seq `same | changed | only_a | only_b`, plus the
  first divergence seq.

CLI mirrors all of it: `durabl inspect|diff|tree|list-forks|export <…>`. Config
(ingress, db paths) is env-var only; no secrets read or logged.

---

## 3. The adversarial M2 gate (real evidence)

Single command, CI-suitable:

```bash
npm run gate:m2     # == npm run test:m2
```

It wipes state, starts a **real** `restate-server`, and runs six sub-gates. The
crash sub-gates use a **real uncatchable `process.kill(pid,'SIGKILL')`** of the
SDK service (the M1 harness style) and assert `service_really_died` via
`process.kill(pid,0)` before recovery. Every number is read from the **real**
SQLite effect sink + journal — no mocks on the crash path, no happy-path-only.

Sub-gates:

1. **fork-no-refire** — fork from `N=2` (effect in seeded prefix);
   `fork_NEW_effects=0`, the path diverges at seq 3, and both trajectories are
   independently inspectable (`seededSeqs=[1,2]`, lineage correct).
2. **multi-level-fork** — fork→fork→fork (root→l1→l2→l3); lineage chain correct,
   **no ancestor effect re-fires at any level** (`effects=[1,0,0,0]`), all three
   diverge, the seeded step output is byte-identical down every level.
3. **concurrent-forks** — 6 forks off the **same** parent invoked concurrently;
   no journal corruption (each fork = 3 steps), no cross-contamination (6 distinct
   answers, every fork `NEW_effects=0`), the whole family has exactly **one**
   `step2` effect (the parent's).
4. **crash-during-fork(new-effect)** — fork from `N=1` so the fork fires its own
   `step2` effect; **SIGKILL at the dangerous `after-effect:step2` window** of the
   forked run; on recovery the forked trajectory is **exactly-once**
   (`forked_effect_fires=1`) and the source effect is untouched.
5. **crash-during-fork(seeded-no-refire)** — fork from `N=2`; crash mid-divergence
   (`before:step3`); the **seeded** effect still **never re-fires**
   (`fork_NEW_effects=0`) across the crash.
6. **fork-validation** — `validateForkPlan` rejects unknown source, out-of-range
   seq, self-fork, target collision; accepts a valid plan. (Read-only.)

### 3.1 REAL gate output (pasted verbatim)

Full log: [`m2-evidence/gate-evidence.log`](m2-evidence/gate-evidence.log). Run on
2026-06-01, Node, Restate `1.6.2` / SDK `1.14.4`, `npm run gate:m2` exit code 0.

```
[GATE PASS] fork-no-refire
  seeded=2(expect 2) src_effects=1(expect 1) fork_NEW_effects=0(expect 0) diverged_answer=true first_divergence_seq=3(expect 3) fork_seededSeqs=[1,2](expect 1,2) lineage_ok=true src_answer="answer[main]<<plan-for(original-prompt)|tool-result(effectId=52)|prompt=original-prompt>>" fork_answer="answer[what-if]<<plan-for(original-prompt)|tool-result(effectId=52)|prompt=what-if-prompt>>"

[GATE PASS] multi-level-fork
  lineage=m2-ml-root-1780349329244->m2-ml-l1-1780349329259->m2-ml-l2-1780349329268->m2-ml-l3-1780349329277 (expect m2-ml-root-1780349329244->l1->l2->l3 shape) chain_ok=true effects[root=1,l1=0,l2=0,l3=0] (expect 1,0,0,0) distinct_answers=3(expect 3) seeded_step2_identical_all_levels=true

[GATE PASS] concurrent-forks
  forks=6 parent_effects=1(expect 1) per_fork_NEW_effects=[0,0,0,0,0,0](expect all 0) distinct_answers=6(expect 6) all_journals_3steps=true family_total_step2_effects=1(expect 1)

[GATE PASS] crash-during-fork(new-effect)
  seeded=1(expect 1) service_really_died=true forked_effect_fires=1(expect 1 exactly-once) source_effects_unchanged=1(expect 1) seq1_seeded_from_source=true journal_steps=[step1-plan,step2-tool_call,step3-summarize] result="answer[crash-fork]<<plan-for(src)|tool-result(effectId=56)|prompt=diverge>>"

[GATE PASS] crash-during-fork(seeded-no-refire)
  seeded=2(expect 2) service_really_died=true fork_NEW_effects=0(expect 0 even across crash) source_effects_unchanged=1(expect 1) journal_steps=[step1-plan,step2-tool_call,step3-summarize] result="answer[crash-seeded]<<plan-for(src)|tool-result(effectId=58)|prompt=diverge>>"

[GATE PASS] fork-validation
  unknown-source=rejected out-of-range-seq=rejected self-fork=rejected collision-target=rejected valid_plan_accepted=true
```

The real SIGKILL + engine recovery on the `crash-during-fork(new-effect)` path is
visible in the server log (the forked run is killed at the dual-write window and
**replayed** to completion):

```
[CRASH] SIGKILL self at point=after-effect:step2 run=m2-cdf-fork-... pid=...
WARN restate_invoker_impl  Invocation error, retrying ... connection reset (RT0010)
[restate] INFO: Restate SDK started listening on 9080...
[restate][AgentRun/m2-cdf-fork-.../run][inv_...] INFO: Replaying invocation.
[restate][AgentRun/m2-cdf-fork-.../run][inv_...] INFO: Invocation completed successfully.
```

### 3.2 Summary (pasted verbatim)

```
================ M2 GATE SUMMARY ================
PASS  fork-no-refire
PASS  multi-level-fork
PASS  concurrent-forks
PASS  crash-during-fork(new-effect)
PASS  crash-during-fork(seeded-no-refire)
PASS  fork-validation
-------------------------------------------------
6/6 gates passed
VERDICT: GATE PASSED
=================================================
```

`npm run gate:m2` exits 0. The M1 gate still passes 10/10 (`npm test`) — the
durable core is unchanged.

---

## 4. The single demo that proves the company

```bash
npm run demo
```

Scripted end-to-end narrative against a real `restate-server` with a real SIGKILL
(every printed number read from the real effect sink + journal):

1. Start an agent run; **kill it mid-run** at the dangerous after-effect window.
2. It **resumes from the exact step**; the side effect did **not** double-fire
   (exactly-once). [M1]
3. **Open the trajectory** from the portable journal.
4. **Fork from an earlier step** (before the tool call) with a **new decision** —
   the forked path makes its own tool call.
5. **Diff** the two trajectories + show lineage, proving the fork fired its own
   effect exactly once while the original's effect was never touched, and that
   the **fork lineage travels with the portable export**. [M2]

Full output: [`m2-evidence/demo-output.log`](m2-evidence/demo-output.log). Key
lines (pasted verbatim):

```
ACT 2 — Resume from the exact step. Exactly-once preserved.
  → run recovered and completed: "answer[main]<<plan-for(ship-the-invoice)|tool-result(effectId=49)|prompt=ship-the-invoice>>"
  → side-effect fire count (read from REAL effect sink): 1 (expect 1)
  → EXACTLY-ONCE across crash: YES ✓

ACT 5 — Compare the two trajectories. Prove no cross-fire.
  original effect fires (unchanged by the fork): 1 (expect 1)
  forked path effect fires (its OWN new effect):  1 (expect 1)
  first divergence at seq: 2
    seq 1 step1-plan: same
    seq 2 step2-tool_call: changed
    seq 3 step3-summarize: changed
  lineage of fork: demo-...[main] → demo-fork-...[what-if]

VERDICT: DEMO PASSED — this is the single demo that proves the company.
```

(The portable export of the fork, with its `run_meta` lineage line first, is
printed in full in the demo log.)

---

## 5. CLI quick reference

```bash
durabl run <runId> --prompt <p> [--trajectory <t>]
durabl fork <sourceRunId> --at <N> --new <newRunId> --prompt <p> [--trajectory <t>]
durabl inspect <runId>          # trajectory + lineage + effects + seeded seqs + forks
durabl list-forks <runId>       # direct child forks
durabl tree <runId>             # full descendant fork tree
durabl diff <runA> <runB>       # per-seq divergence + first divergence seq
durabl export <runId> [--meta]  # portable JSONL; --meta includes the lineage line
durabl runs                     # all known runs
```

`run`/`fork` invoke the Restate ingress (`DURABL_RESTATE_INGRESS`). All other
commands are pure journal reads.

---

## 6. Limits (do not over-claim)

- Same single-node, single-machine envelope as M1 (no multi-partition failover /
  network partition / clock-skew testing — substrate concern).
- Steps are synthetic (no real LLM/tool latency). The no-refire + exactly-once
  guarantees depend on the side effect routing through the structural idempotency
  contract — which the reference workflow enforces and a real tool must too.
- M2 inspection is **programmatic + CLI read-only**. The full replay/time-travel
  **UI is M3**, deliberately not built. The read API (`inspectRun`, `lineage`,
  `forkTree`, `diffTrajectories`) and the portable lineage export are the exact
  surfaces a UI renders, so M3 is a natural next step with no core change.
- Concurrent-forks seeds sequentially then diverges concurrently; it does not test
  multiple independent worker hosts seeding the same target (target-collision is
  validated/rejected, not raced).

---

## 7. STATUS / M3 go-no-go

**STATUS: DONE.** The M2 adversarial gate passes **6/6** with real SIGKILL
evidence: fork from step N fires **zero** new seeded effects (`fork_NEW_effects=0`)
while diverging; multi-level forks keep lineage correct with no ancestor re-fire
(`effects=[1,0,0,0]`); 6 concurrent forks off one parent stay uncorrupted and
uncross-contaminated (`family_total_step2_effects=1`, 6 distinct answers); and
**crash-during-fork preserves exactly-once on the forked trajectory** — both when
the fork fires its own effect (`forked_effect_fires=1` across SIGKILL at the
dual-write window) and when the effect was seeded (`fork_NEW_effects=0` across a
mid-divergence crash). The M1 core is unchanged and still 10/10. The single
`npm run demo` performs the full company-proving narrative end-to-end and passes.

**M3 (observability / replay / time-travel UI) go/no-go: GO.** The correctness-
critical work is done and the read surfaces a UI needs already exist and are
proven: `inspectRun`, `lineage`, `forkTree`, `diffTrajectories`, and a portable
export that carries fork lineage. M3 is a rendering layer over a journal that is
neutral, portable, exactly-once-safe, and fork-aware — no engine modification and
no core change required. The Phase 0 kill-switches remain the watch items (a
funded neutral self-hosted replay+fork competitor; Google AX adding cross-substrate
portability + a polished replay UI).
