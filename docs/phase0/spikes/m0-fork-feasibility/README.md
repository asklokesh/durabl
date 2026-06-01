# M0 Fork-Feasibility Spike — THROWAWAY

> **This is throwaway spike code. It is NOT production.** Its only job is to
> KILL or CONFIRM the one risky M0 assumption from the Phase 0 validation report:
> *can we build logical step-level trajectory fork + crash-safe exactly-once
> replay over an existing step-journal engine's journal, without reimplementing
> the engine?* Do not build M1 on this code; rebuild cleanly if the gate passes.

## What this proves (and how)

Substrate (per `docs/phase0/validation-report.md`, Decision 1–3): **Restate**
(TS-first, single self-hostable binary, neutral) — server + CLI **1.6.2**, TS SDK
**1.14.4**. No Docker, no cloud: `restate-server` and `restate` run as native
binaries (installed as devDependencies). Durability mechanism: **step-journal**
(`ctx.run`), never process snapshot / CRIU.

The spike is a 3-step agent-style workflow (`src/service.ts`):

| seq | step               | kind                                   |
|-----|--------------------|----------------------------------------|
| 1   | `step1-plan`       | journaled step (deterministic-ish)     |
| 2   | `step2-tool_call`  | **side-effecting tool call**           |
| 3   | `step3-summarize`  | journaled step; diverges per trajectory|

Two cooperating durability layers:

1. **Restate `ctx.run`** — engine-level at-least-once step execution + replay
   from the engine journal after a process crash.
2. **Neutral portable app journal** (`src/journal.ts`, plain SQLite via Node's
   built-in `node:sqlite`) — the actual durabl artifact: a structured,
   substrate-agnostic, JSONL-exportable record of each step's output, and the
   substrate for **logical fork** (`forkRun`: seed a new run from a source run's
   journal up to seq N, then diverge).

**Exactly-once at the side-effect sink** (`src/effects.ts`): the side effect is
recorded with a deterministic idempotency key `runId:stepName` under a `UNIQUE`
index, so an `at-least-once` re-fire after a crash dedups to a single logical
firing. This is the industry-standard pattern (the engine guarantees at-least-
once step execution; the effect must be idempotent for end-to-end exactly-once).

## How to run

```bash
cd docs/phase0/spikes/m0-fork-feasibility
npm install            # installs Restate TS SDK + native restate-server/CLI binaries
npm run build
npm run gate           # runs ALL adversarial gates (manages its own server+service)
```

Run a single gate group:

```bash
node dist/harness/run-gates.js crash        # 7 crash-boundary exactly-once gates
node dist/harness/run-gates.js fork         # logical fork correctness
node dist/harness/run-gates.js concurrency  # 8 racing workers, one effect
node dist/harness/run-gates.js replay       # replay determinism
```

The harness (`src/harness/run-gates.ts`) starts `restate-server`, starts the SDK
service, registers the deployment, then drives the gates. For each crash gate it
**actually SIGKILLs the SDK service process** mid-invocation (`process.kill(pid,
'SIGKILL')` — a real, uncatchable OS kill, NOT a thrown exception), restarts it,
lets Restate drive recovery, and asserts the side effect fired **exactly once**
by counting rows in the real SQLite effect log.

State lives under `/tmp/durabl-m0-spike/` (restate data, effect log, journal,
crash markers). The harness resets it on each full run.

## Files

- `src/service.ts` — the 3-step workflow + crash-injection points.
- `src/effects.ts` — idempotent external-effect log (SQLite). Double-fire detector.
- `src/journal.ts` — neutral portable step journal + `forkRun` (logical fork).
- `src/fork.ts` — fork driver / CLI.
- `src/harness/restate-control.ts` — server/service lifecycle helpers.
- `src/harness/run-gates.ts` — the adversarial gate harness.
- `gate-evidence.log` — captured real output of a full `npm run gate` (10/10 PASS).

See `../../m0-spike-findings.md` for the verdict and pasted evidence.
