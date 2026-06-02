# durabl M5 — Human-in-the-Loop (HITL) + State Export (the final milestone)

**Date:** 2026-06-01
**Status:** PRODUCTION milestone — the FINAL one (build-plan §5 M5, PRD §3.4).
**Builds on:** M1 (portable step journal + structural exactly-once on Restate),
M2 (logical fork), M3 (substrate-independent replay over a `JournalSource`),
M4 (model/deploy neutrality seams). M5 does **not** rewrite the durable core, the
fork layer, the replay engine, or the neutrality layer — it adds one durable
**HITL pause/resume** primitive that **reuses the M1 idempotency contract
verbatim**, plus the proof that the existing journal export carries a HITL run.
**Substrate:** Restate (server/CLI `1.6.2`, SDK `1.14.4`). Runtime: Node 26.

> The literal M5 bar: pause a run for human input, resume across a **real process
> restart** (not an in-memory await), resume to completion, and export the full
> execution journal — with REAL evidence. All four are proven below.

---

## 1. The pause/resume model

The HITL reference workflow (`src/hitl-workflow.ts`, service `HitlAgentRun`) is a
5-logical-step agent loop with a durable pause in the middle:

```
seq 1  step1-plan        plan          model/provider call (M4 seam), journaled once
seq 2  hitl-pause        hitl_pause    ← run durably SUSPENDS here awaiting human input
seq 3  hitl-input        hitl_input    ← the human decision, journaled EXACTLY ONCE
seq 4  step4-tool_call   tool_call     ← side-effecting; fires through the idempotent sink
seq 5  step5-summarize   summarize     folds in the human decision
```

### What makes the pause durable (no in-memory dependency)

Two cooperating facts, neither of which lives in process memory:

1. **The substrate suspension.** The `run` handler awaits a Restate
   **workflow-bound durable promise** — `await ctx.promise<HitlInput>("hitl.input")`.
   Restate persists this suspension in its own log (`RESTATE_BASE_DIR`). The SDK
   service process — and the `restate-server` itself — can **fully exit or be
   SIGKILLed** while the run is paused; the suspension is recovered on restart.
2. **The journaled pause marker.** Before awaiting, the workflow records a
   `hitl_pause` step into the **portable durabl journal**. Its presence (with no
   `hitl_input` step yet) **is** the durable "paused awaiting input" state. A
   reader — the CLI (`durabl hitl-status` / `durabl paused`), the M3 replay
   engine, or an importer of an export — can see the run is paused with **no live
   process and no substrate running at all** (`journal.ts: hitlState()`).

Resuming is symmetric: a **fresh process** calls the shared handler
`provideInput`, which resolves the durable promise. Restate wakes the suspended
invocation, replays the journal (short-circuiting completed steps), journals the
human input, and runs the side-effecting tail to completion.

```ts
// run handler (durable suspend):
await ctx.run("hitl-pause", () => recordStep({ ... kind: "hitl_pause" ... }).value);
const human = await ctx.promise<HitlInput>("hitl.input");   // process may fully exit here
const decision = await ctx.run("hitl-input", () =>
  recordStep({ ... kind: "hitl_input", producer: () => human.decision }).value);

// provideInput shared handler (from a fresh process, resolves the suspension):
await ctx.promise<HitlInput>("hitl.input").resolve(input);
```

---

## 2. How HITL reuses the M1 idempotency contract (not a new mechanism)

HITL adds **no new correctness primitive**. The pause point and the human input
are ordinary journaled steps under the same contract M1 made structural:

- **Every step is keyed `deriveIdempotencyKey(runId, stepName)`** — including
  `hitl-pause` (`runId:hitl-pause`) and `hitl-input` (`runId:hitl-input`). On a
  resume/replay, `recordStep` finds step1 and the pause **already journaled** and
  returns their stored output **without re-running them**, so **no prior side
  effect re-fires** (exactly the M1 short-circuit, unchanged).
- **The human input is exactly-once at three layers:**
  1. Restate durable promises are **resolve-once** — the first `provideInput`
     resolves and wakes the run; any later submit (same *or* different value) is a
     no-op against the already-resolved promise. `provideInput` `peek()`s first
     and returns `accepted:false` for a duplicate so the caller can tell.
  2. The `hitl_input` step is journaled under `(run_id, seq)` PRIMARY KEY and
     `(run_id, idem_key)` UNIQUE — a second journaling collapses to one row.
  3. The post-resume side effect (step 4) fires through the **same `fireEffect`
     sink** with the derived key, whose `UNIQUE(idem_key)` dedups any crash-driven
     re-fire — so a SIGKILL in the resume dual-write window is still exactly-once.

The result: **supplying input is exactly-once**, double-submitting does not
double-resume or double-fire, and a crash during resume preserves exactly-once —
all inherited from the existing contract, nothing weakened.

---

## 3. State export completeness (the export already carries HITL)

The M1/M2/M3 export path (`exportJsonl` / `exportJsonlWithEffects` /
`exportBundleJsonl`) is **kind-agnostic**: it emits every `JournalEntry` for a
run regardless of `kind`. Because `hitl_pause` and `hitl_input` are ordinary
journal entries, they travel in the export **for free** — no export change was
needed. The export of a completed HITL run is a complete, portable,
self-contained record: `run_meta` + all 5 steps (including the two HITL events) +
the single side effect. The M3 replay engine (`reconstruct()` over an
`importJournalSource(bundle)`) reconstructs it **offline, with no substrate**,
**byte-identical** to the live reconstruction (`replay_divergence=none`),
including the pause/input events (gate G4 below).

**Completeness proof:** the exported HITL bundle (`docs/m5-evidence/hitl-run-bundle.jsonl`)
contains, verbatim, the run_meta, `step1-plan`, `hitl-pause` (with its `awaiting`
marker), `hitl-input` (the human decision), `step4-tool_call`, `step5-summarize`,
and the lone `effect` row — and G4 reconstructs all of it offline with zero
divergence. Nothing substrate-specific leaks; the file is the full run.

---

## 4. The M5 gate (real evidence, single command)

```bash
npm run gate:m5      # == npm run test:m5
```

The gate (`src/harness/run-m5-gate.ts`) wipes state, then for each sub-gate starts
a **real** `restate-server` + SDK service, and on the restart paths does a
**genuine fresh server bind** (it waits until the ingress port is released before
restarting — no silent riding of a stale server). No mocks on the crash/restart
paths; the SIGKILL is an uncatchable OS kill; every number is read from the real
SQLite effect sink + journal.

| Sub-gate | Proves |
|---|---|
| **G1 pause→exit→restart→resume→complete** | run pauses durably (asserted **from the journal**, `effects_while_paused=0`); the SDK service **and** `restate-server` are killed entirely (`substrate_fully_killed=true`) while paused and the journal **still** shows paused; a **fresh** server + service then receive the human input and the run **resumes and completes**; prior side effects did **not** re-fire (`prior_side_effects_refired=false`), the post-resume tool fired **exactly once**, and the human decision is folded into the result |
| **G2 crash-during-resume** | SIGKILL at the dual-write window (`on-resume:after-effect`) during resume → restart → recover → **still exactly-once** (`tool_effects=1`) |
| **G3 double-submit** | `provideInput` called 3× (first + duplicate + a conflicting value) → resumes **once**, `tool_effects=1`, one `hitl_input` step, journaled input = the **first** decision, duplicates report `accepted=false` |
| **G4 full-journal export → offline replay** | export the completed HITL run; **kill the substrate**; reconstruct from the export **alone** → `replay_divergence=none`, `hitl_pause` + `hitl_input` present offline, `offline_effects=1` |

### 4.1 REAL gate output (pasted verbatim)

Full log: [`m5-evidence/gate-evidence.log`](m5-evidence/gate-evidence.log). Run on
2026-06-01, Node 26, Restate `1.6.2` / SDK `1.14.4`, `npm run gate:m5` **exit code 0**.

```
[GATE PASS] G1 pause→exit→restart→resume→complete
  paused_from_journal=true effects_while_paused=0(expect 0) substrate_fully_killed=true still_paused_after_kill=true resumed_after_restart=true input_accepted=true prior_side_effects_refired=false post_resume_tool_effects=1(expect 1) human_in_journal=true answer_has_human_decision=true steps=[step1-plan,hitl-pause,hitl-input,step4-tool_call,step5-summarize] result="answer[main]<<echo[plan-for(ship-it)]@fake-echo:simulated|human=APPROVED-by-human|tool-result(effectId=181;approved=APPROVED-by-human)|prompt=ship-it>>"

[GATE PASS] G2 crash-during-resume → exactly-once
  paused=true service_really_died_at_on-resume:after-effect=true tool_effects=1(expect 1) resumed=true completed=true result="answer[main]<<echo[plan-for(crash-on-resume)]@fake-echo:simulated|human=APPROVED-crash|tool-result(effectId=182;approved=APPROVED-crash)|prompt=crash-on-resume>>"

[GATE PASS] G3 double-submit → idempotent (resumes once)
  paused=true first_accepted=true(expect true) dup_accepted=false(expect false) conflicting_accepted=false(expect false) tool_effects=1(expect 1) hitl_input_steps=1(expect 1) journaled_input="APPROVED-first"(expect "APPROVED-first") result="answer[main]<<echo[plan-for(double-submit)]@fake-echo:simulated|human=APPROVED-first|tool-result(effectId=184;approved=APPROVED-first)|prompt=double-submit>>"

# exported HITL run bundle (7 lines) → docs/m5-evidence/hitl-run-bundle.jsonl
# substrate killed: dead=true

[GATE PASS] G4 full-journal export → offline HITL replay
  substrate_dead=true reconstructed_from=imported:hitl-run-bundle.jsonl replay_divergence=none hitl_pause_in_export=true hitl_input_in_export=true offline_effects=1(expect 1) steps=[step1-plan,hitl-pause,hitl-input,step4-tool_call,step5-summarize]

================ M5 GATE SUMMARY ================
PASS  G1 pause→exit→restart→resume→complete
PASS  G2 crash-during-resume → exactly-once
PASS  G3 double-submit → idempotent (resumes once)
PASS  G4 full-journal export → offline HITL replay
------------------------------------------------
4/4 gates passed
VERDICT: GATE PASSED
================================================
```

### 4.2 The real restart is visible in the substrate log

The G1 server log (verbatim, `gate-evidence.log`) shows the SDK service start the
invocation, the substrate go down, then a **fresh** SDK process **replay** the
invocation and complete it after input arrives — a genuine process death, not an
in-process await:

```
[restate] INFO: Restate SDK started listening on 9080...
[restate][HitlAgentRun/m5-hitl-…/run][inv_…] INFO: Starting invocation.
… (service + server SIGKILLed while paused; substrate_fully_killed=true) …
[restate] INFO: Restate SDK started listening on 9080...                 ← fresh process
[restate][HitlAgentRun/m5-hitl-…/run][inv_…] INFO: Replaying invocation.  ← resume by replay
[restate][HitlAgentRun/m5-hitl-…/provideInput][inv_…] INFO: Invocation completed successfully.
[restate][HitlAgentRun/m5-hitl-…/run][inv_…] INFO: Invocation completed successfully.
```

---

## 5. Running it / CLI surface

```bash
# The gate (pause → process-exit → restart → resume → complete, crash-on-resume,
# double-submit, export+offline-replay), single command, exit 0:
npm run gate:m5

# Manual HITL via the CLI (config is env-var only; localhost; no secrets logged):
#   1) start the substrate + service in one shell:
npm run build && (DURABL_SERVE=1 node dist/service.js &) && \
  node_modules/.bin/restate-server &           # then: restate deployments register http://localhost:9080
#   2) start a HITL run — it pauses and the CLI returns immediately:
node dist/cli.js hitl-run my-run --prompt "ship the release?"
node dist/cli.js hitl-status my-run            # -> { state: "paused" }
node dist/cli.js paused                         # -> ["my-run"]
#   3) (you may kill/restart everything here — the run stays durably paused) …
#   4) supply the human decision; the run resumes and completes:
node dist/cli.js hitl-input my-run --decision "APPROVED"
node dist/cli.js hitl-status my-run            # -> { state: "resumed" }
#   5) export + offline replay (no substrate needed):
node dist/cli.js export-bundle my-run > hitl.jsonl
node dist/cli.js replay my-run --from hitl.jsonl
```

---

## 6. Web-UI affordance — shipped on `feat/hitl-web-ui` (post-M5)

M5 shipped CLI-only resume. The follow-up branch adds the M3 web UI affordance
without touching the M5 gate:

- **Read:** journal-derived paused runs (`/api/hitl/paused`, `hitlState` on `/api/runs`).
- **Write (live only):** `POST /api/hitl/input` → same `provideInput` path as `durabl hitl-input`.
- **Offline:** paused runs visible from export; submit returns 503 (no substrate).
- **Testing:** `npm run gate:hitl-ui` — fetch-based only; no browse daemon in the server process.

See [`hitl-web-ui.md`](hitl-web-ui.md).

---

## 7. Limits (do not over-claim)

- Same single-node envelope as M1–M4 (no multi-partition / network-partition /
  clock-skew testing — substrate concern).
- Steps are synthetic and the model provider defaults to a deterministic fake
  (`fake-echo`) so the gate is CI-safe and offline; real providers (M4) plug in
  via `DURABL_MODEL_PROVIDER` with no code change. The HITL/exactly-once logic is
  content-agnostic.
- "Process restart" is a real OS process death + fresh process on the same host
  reusing the substrate's persisted state dir; cross-host failover is a substrate
  concern, untested here.
- Web UI resume is on `feat/hitl-web-ui` (§6); M5 mainline remains CLI-only.

---

## 8. STATUS

**STATUS: DONE.** The M5 gate passes **4/4** with real evidence: a HITL run pauses
durably (journal-asserted, zero effects while paused), survives the **entire
substrate being killed**, and **resumes across a fresh server + fresh service
process** to completion with **prior side effects not re-fired and the post-resume
effect fired exactly once** (G1); a SIGKILL at the resume dual-write window stays
exactly-once (G2); double-submitting human input resumes once and fires once (G3);
and the full-journal export of the HITL run reconstructs **offline, byte-identical,
including the pause/input events**, with the substrate dead (G4). HITL reuses the
M1 idempotency contract verbatim — the pause and the human input are journaled,
deterministically-keyed steps. M1 (10/10), M2 (6/6), M3 (5/5), and M4 (4/4) still
pass — the durable core, fork, replay, and neutrality layers are unchanged.
