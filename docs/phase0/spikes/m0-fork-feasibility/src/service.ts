// THROWAWAY SPIKE CODE — not production.
//
// A 3-step agent-style workflow on Restate, layered over the neutral portable
// step journal (journal.ts). Two durability layers cooperate:
//
//   1. Restate ctx.run(...) — engine-level exactly-once across process crash:
//      Restate journals the step output and replays it from its own log after a
//      SIGKILL, so the body does not re-execute.
//   2. App journal recordOnce(...) — neutral/portable record of each step output
//      AND the substrate for LOGICAL FORK: a forked run is seeded with prior
//      step outputs, so recordOnce sees them as already-present and SHORT-CIRCUITS
//      (no re-execution → no side-effect re-fire) for steps <= fork point.
//
// Step 2 is the SIDE-EFFECTING tool call: it writes a row to the effect log
// (effects.ts) inside both guards. Any double-fire (Restate failure OR fork
// failure) shows up as >1 effect_log row for the run.
//
// Crash injection: env CRASH_AT triggers a real SIGKILL of THIS process (never a
// catchable throw) at a chosen boundary. See README for CRASH_AT values.

import * as restate from "@restatedev/restate-sdk";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fireEffect } from "./effects.js";
import { ensureMeta, recordOnce } from "./journal.js";

const CRASH_AT = process.env.CRASH_AT ?? "";
const CRASH_ONCE = process.env.CRASH_ONCE === "1";
const MARKER_DIR = process.env.CRASH_MARKER_DIR ?? "/tmp/durabl-m0-spike/markers";

function alreadyCrashed(runId: string, point: string): boolean {
  const f = join(MARKER_DIR, `${runId}__${point.replace(/[^a-z0-9]/gi, "_")}`);
  if (existsSync(f)) return true;
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, new Date().toISOString());
  return false;
}

// Real, uncatchable process death — NOT a thrown exception.
function maybeCrash(runId: string, point: string): void {
  if (CRASH_AT !== point) return;
  if (CRASH_ONCE && alreadyCrashed(runId, point)) return;
  console.error(
    `[CRASH] SIGKILL self at point=${point} run=${runId} pid=${process.pid}`,
  );
  process.kill(process.pid, "SIGKILL");
  while (true) {} // unreachable; ensure no further work if signal is delayed
}

export interface WorkflowInput {
  prompt: string;
  trajectory?: string;
}

export interface WorkflowOutput {
  runId: string;
  trajectory: string;
  plan: string;
  toolResult: string;
  answer: string;
  step2Replayed: boolean;
}

const STEP = { plan: 1, tool: 2, summarize: 3 } as const;

export const agentWorkflow = restate.workflow({
  name: "AgentRun",
  handlers: {
    run: async (
      ctx: restate.WorkflowContext,
      input: WorkflowInput,
    ): Promise<WorkflowOutput> => {
      const runId = ctx.key;
      const trajectory = input.trajectory ?? "main";
      ensureMeta(runId, trajectory);

      maybeCrash(runId, "before:step1");

      // STEP 1 — plan
      const plan = await ctx.run("step1-plan", () =>
        recordOnce(runId, STEP.plan, "step1-plan", false, () => `plan-for(${input.prompt})`).value,
      );

      maybeCrash(runId, "after:step1");

      // STEP 2 — SIDE-EFFECTING tool call.
      const step2 = await ctx.run("step2-tool_call", () => {
        return recordOnce(runId, STEP.tool, "step2-tool_call", true, () => {
          maybeCrash(runId, "before-effect:step2");
          const fired = fireEffect({
            runId,
            trajectory,
            stepName: "step2-tool_call",
            payload: { plan },
          });
          maybeCrash(runId, "after-effect:step2");
          return `tool-result(effectId=${fired.id})`;
        });
      });
      const toolResult = step2.value;

      maybeCrash(runId, "after:step2");
      maybeCrash(runId, "before:step3");

      // STEP 3 — summarize
      // step3 diverges per trajectory: a forked run (different trajectory label
      // and/or prompt) produces a different summary while reusing the seeded
      // step1/step2 outputs verbatim. This makes logical fork divergence
      // observable in the journal.
      const answer = await ctx.run("step3-summarize", () =>
        recordOnce(runId, STEP.summarize, "step3-summarize", false, () =>
          `answer[${trajectory}]<<${plan}|${toolResult}|prompt=${input.prompt}>>`,
        ).value,
      );

      maybeCrash(runId, "after:step3");

      return {
        runId,
        trajectory,
        plan,
        toolResult,
        answer,
        step2Replayed: step2.replayed,
      };
    },

    getStatus: async (
      ctx: restate.WorkflowSharedContext,
    ): Promise<{ runId: string }> => {
      return { runId: ctx.key };
    },
  },
});

restate.serve({
  services: [agentWorkflow],
  port: Number(process.env.SERVICE_PORT ?? 9080),
});
