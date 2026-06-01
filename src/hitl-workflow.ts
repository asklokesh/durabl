// ─────────────────────────────────────────────────────────────────────────────
// HUMAN-IN-THE-LOOP (HITL) REFERENCE WORKFLOW — M5.
//
// A 4-logical-step agent loop that PAUSES for human input, suspends DURABLY
// (state in the journal + the substrate's persisted suspension, NOT in memory),
// survives a FULL process exit, and RESUMES across a fresh process to completion
// — with the M1 exactly-once contract reused verbatim.
//
//   step1  plan                (model/provider call, journaled — M4 seam)
//   PAUSE  hitl_pause          ← run durably suspends here awaiting human input
//   step2  hitl_input          ← the human decision, journaled exactly once
//   step3  tool_call (effect)  ← side-effecting; fires through the idempotent sink
//   step4  summarize
//
// HOW THE DURABLE PAUSE WORKS (no in-memory dependency):
//   The `run` handler awaits a Restate WORKFLOW-BOUND DURABLE PROMISE
//   (`ctx.promise("hitl.input")`). Restate persists the suspension in its log,
//   so the SDK service process can fully EXIT / be SIGKILLed while paused. A
//   fresh process resolves that durable promise via the `provideInput` shared
//   handler; Restate then wakes the suspended invocation (replaying the journal,
//   short-circuiting completed steps) and runs it to completion.
//
// HOW EXACTLY-ONCE IS PRESERVED (M1 contract reused, NOT weakened):
//   - Every step (incl. the pause marker and the human input) is a durabl
//     `recordStep` step keyed by `deriveIdempotencyKey(runId, stepName)`.
//   - On resume, Restate replays the workflow; `recordStep` finds step1 + the
//     pause already journaled and returns their stored output WITHOUT re-running
//     them, so NO prior side effect re-fires.
//   - The human input is journaled under `runId:hitl-input`; the durable promise
//     is RESOLVE-ONCE, so a double-submit dedups (the second resolve is a no-op),
//     and even if it weren't, the journaled `hitl_input` step's (run_id, seq)
//     primary key + (run_id, idem_key) unique index collapse it to one.
//   - The side-effecting tool (step3) fires through the SAME `fireEffect` sink
//     with the derived key → a crash during resume dedups to exactly-once.
// ─────────────────────────────────────────────────────────────────────────────

import * as restate from "@restatedev/restate-sdk";
import { fireEffect } from "./effect-sink.js";
import { ensureRunMeta, recordStep, recordStepAsync } from "./journal.js";
import type {
  HitlInput,
  HitlWorkflowInput,
  HitlWorkflowOutput,
} from "./step-model.js";
import { maybeCrash } from "./crash-inject.js";
import { config } from "./config.js";
import { getModelProvider } from "./providers/registry.js";

/** The name of the workflow-bound durable promise the run blocks on. */
export const HITL_PROMISE = "hitl.input";

/** Stable logical step names — the basis of the deterministic idempotency key. */
export const HITL_STEP = {
  plan: { seq: 1, name: "step1-plan" },
  pause: { seq: 2, name: "hitl-pause" },
  input: { seq: 3, name: "hitl-input" },
  tool: { seq: 4, name: "step4-tool_call" },
  summarize: { seq: 5, name: "step5-summarize" },
} as const;

export const hitlAgentRun = restate.workflow({
  name: "HitlAgentRun",
  handlers: {
    /**
     * The durable run. Pauses at the HITL point until `provideInput` resolves the
     * durable promise — surviving a full process exit in between.
     */
    run: async (
      ctx: restate.WorkflowContext,
      input: HitlWorkflowInput,
    ): Promise<HitlWorkflowOutput> => {
      const runId = ctx.key;
      const trajectory = input.trajectory ?? "main";
      ensureRunMeta(runId, trajectory);

      maybeCrash(runId, "before:step1");

      // STEP 1 — model/provider call (M4 neutrality seam), journaled once.
      const plan = await ctx.run(HITL_STEP.plan.name, () =>
        recordStepAsync({
          runId,
          seq: HITL_STEP.plan.seq,
          stepName: HITL_STEP.plan.name,
          kind: "plan",
          sideEffect: false,
          producer: async () => {
            const provider = getModelProvider();
            const completion = await provider.complete({
              system: "You are a planning step in a durable HITL agent. Be terse.",
              prompt: `plan-for(${input.prompt})`,
              maxTokens: 64,
            });
            return `${completion.text}@${completion.meta.provider}:${completion.meta.mode}`;
          },
        }).then((r) => r.value),
      );

      maybeCrash(runId, "after:step1");

      // PAUSE — journal the durable "paused awaiting human input" marker. Its
      // presence in the journal IS the durable paused state; a reader (CLI / UI /
      // M3 replay) sees the run is awaiting input WITHOUT any live process.
      await ctx.run(HITL_STEP.pause.name, () =>
        recordStep({
          runId,
          seq: HITL_STEP.pause.seq,
          stepName: HITL_STEP.pause.name,
          kind: "hitl_pause",
          sideEffect: false,
          producer: () => ({ awaiting: HITL_PROMISE, planSoFar: plan }),
        }).value,
      );

      maybeCrash(runId, "at-pause:before-await");

      // DURABLE SUSPEND. The process may fully EXIT here; Restate persists the
      // suspension. A fresh process resumes it when provideInput resolves this.
      const human: HitlInput = await ctx.promise<HitlInput>(HITL_PROMISE);

      maybeCrash(runId, "on-resume:before-input"); // crash-during-resume window

      // Journal the human decision EXACTLY ONCE (idempotent step). On a resume
      // replay this short-circuits and the decision is read from the journal.
      const humanDecision = await ctx.run(HITL_STEP.input.name, () =>
        recordStep({
          runId,
          seq: HITL_STEP.input.seq,
          stepName: HITL_STEP.input.name,
          kind: "hitl_input",
          sideEffect: false,
          producer: () => human.decision,
        }).value,
      );

      maybeCrash(runId, "on-resume:before-effect"); // crash before the side effect

      // STEP — SIDE-EFFECTING tool call, folding in the human decision. Fires
      // through the idempotent sink keyed by the derived idem key (exactly-once).
      const toolResult = await ctx.run(HITL_STEP.tool.name, () =>
        recordStep({
          runId,
          seq: HITL_STEP.tool.seq,
          stepName: HITL_STEP.tool.name,
          kind: "tool_call",
          sideEffect: true,
          producer: (idemKey) => {
            maybeCrash(runId, "on-resume:before-effect-fire");
            const fired = fireEffect({
              runId,
              trajectory,
              stepName: HITL_STEP.tool.name,
              idemKey,
              payload: { plan, humanDecision },
            });
            maybeCrash(runId, "on-resume:after-effect"); // dangerous dual-write window
            return `tool-result(effectId=${fired.id};approved=${humanDecision})`;
          },
        }).value,
      );

      maybeCrash(runId, "on-resume:before-step5");

      // STEP — summarize. Diverges per trajectory + folds in the human decision.
      const answer = await ctx.run(HITL_STEP.summarize.name, () =>
        recordStep({
          runId,
          seq: HITL_STEP.summarize.seq,
          stepName: HITL_STEP.summarize.name,
          kind: "summarize",
          sideEffect: false,
          producer: () =>
            `answer[${trajectory}]<<${plan}|human=${humanDecision}|${toolResult}|prompt=${input.prompt}>>`,
        }).value,
      );

      maybeCrash(runId, "on-resume:after-step5");

      return { runId, trajectory, plan, humanDecision, toolResult, answer };
    },

    /**
     * Shared handler: supply the human input that resumes a paused run.
     *
     * Resolving a workflow-bound durable promise is RESOLVE-ONCE in Restate: the
     * first call resolves it (waking the suspended `run`); any later call with
     * the same (or different) value is a no-op against the already-resolved
     * promise. That makes double-submit IDEMPOTENT at the substrate boundary —
     * the run resumes once and the post-resume side effect fires once. We surface
     * `accepted=false` for the no-op so a caller can tell it was a duplicate.
     */
    provideInput: async (
      ctx: restate.WorkflowSharedContext,
      input: HitlInput,
    ): Promise<{ runId: string; accepted: boolean }> => {
      const runId = ctx.key;
      // peek() returns the resolved value if the promise was already resolved.
      const already = await ctx.promise<HitlInput>(HITL_PROMISE).peek();
      if (already !== undefined) {
        return { runId, accepted: false };
      }
      await ctx.promise<HitlInput>(HITL_PROMISE).resolve(input);
      return { runId, accepted: true };
    },

    /**
     * Shared, read-only: is this run currently paused awaiting input? Reads the
     * durable promise's resolved state. (The authoritative paused state is the
     * journal's hitl_pause/hitl_input steps; this is a convenience probe.)
     */
    status: async (
      ctx: restate.WorkflowSharedContext,
    ): Promise<{ runId: string; inputResolved: boolean }> => {
      const resolved = await ctx.promise<HitlInput>(HITL_PROMISE).peek();
      return { runId: ctx.key, inputResolved: resolved !== undefined };
    },
  },
});

export type HitlAgentRunService = typeof hitlAgentRun;
