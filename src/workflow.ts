// ─────────────────────────────────────────────────────────────────────────────
// REFERENCE WORKFLOW — a 3-step agent-style loop on Restate (step-journal
// substrate), persisting to the neutral portable journal with structural
// per-step idempotency.
//
// Two cooperating durability layers (M0 design):
//   1. Restate ctx.run(...) — engine-level crash durability + automatic retry.
//      The body of a ctx.run runs at-least-once across a crash.
//   2. durabl recordStep(...) — neutral/portable journal AND the idempotency
//      contract: it derives the deterministic idem key and hands it to the step,
//      and short-circuits already-recorded steps (replay / fork seed).
//
// Step 2 is the SIDE-EFFECTING tool call. It can ONLY fire its effect through
// fireEffect, which REQUIRES the derived IdempotencyKey — so the dual-write
// re-fire the M0 spike caught is structurally deduped to exactly-once.
// ─────────────────────────────────────────────────────────────────────────────

import * as restate from "@restatedev/restate-sdk";
import { fireEffect } from "./effect-sink.js";
import { ensureRunMeta, recordStep, recordStepAsync } from "./journal.js";
import type { WorkflowInput, WorkflowOutput } from "./step-model.js";
import { maybeCrash } from "./crash-inject.js";
import { config } from "./config.js";
import { getModelProvider } from "./providers/registry.js";

/** Stable logical step names — the basis of the deterministic idempotency key. */
const STEP = {
  plan: { seq: 1, name: "step1-plan" },
  tool: { seq: 2, name: "step2-tool_call" },
  summarize: { seq: 3, name: "step3-summarize" },
} as const;

export const agentRun = restate.workflow({
  name: "AgentRun",
  handlers: {
    run: async (
      ctx: restate.WorkflowContext,
      input: WorkflowInput,
    ): Promise<WorkflowOutput> => {
      const runId = ctx.key;
      const trajectory = input.trajectory ?? "main";
      ensureRunMeta(runId, trajectory);

      maybeCrash(runId, "before:step1");

      // STEP 1 — MODEL/PROVIDER CALL (the model-neutrality seam, M4).
      //
      // The active provider is chosen by configuration (DURABL_MODEL_PROVIDER)
      // via getModelProvider(); this code never names a concrete provider, so
      // switching providers is config-only — no code change (the M4 bar).
      //
      // DETERMINISM CONTRACT: the (non-deterministic) model call runs INSIDE the
      // durable journaled step (ctx.run -> recordStepAsync). Its output is
      // recorded ONCE into the portable journal; on replay/fork the recorded
      // output short-circuits and the provider is NEVER re-invoked. So a
      // provider switch cannot corrupt exactly-once or replay.
      const plan = await ctx.run(STEP.plan.name, () =>
        recordStepAsync({
          runId,
          seq: STEP.plan.seq,
          stepName: STEP.plan.name,
          kind: "plan",
          sideEffect: false,
          producer: async () => {
            const provider = getModelProvider();
            const completion = await provider.complete({
              system: "You are a planning step in a durable agent. Be terse.",
              prompt: `plan-for(${input.prompt})`,
              maxTokens: 64,
            });
            // Record the model output AND a redacted, key-free provider tag so
            // the journal is self-describing across a provider switch.
            return `${completion.text}@${completion.meta.provider}:${completion.meta.mode}`;
          },
        }).then((r) => r.value),
      );

      maybeCrash(runId, "after:step1");

      // STEP 2 — SIDE-EFFECTING tool call. The effect fires through the
      // idempotent sink keyed by the derived idem key, so a crash-induced
      // re-execution dedups to exactly one logical effect.
      const toolResult = await ctx.run(STEP.tool.name, () => {
        return recordStep({
          runId,
          seq: STEP.tool.seq,
          stepName: STEP.tool.name,
          kind: "tool_call",
          sideEffect: true,
          producer: (idemKey) => {
            maybeCrash(runId, "before-effect:step2");
            const fired = fireEffect({
              runId,
              trajectory,
              stepName: STEP.tool.name,
              idemKey,
              payload: { plan },
            });
            maybeCrash(runId, "after-effect:step2"); // the dangerous window
            return `tool-result(effectId=${fired.id})`;
          },
        }).value;
      });

      maybeCrash(runId, "after:step2");
      maybeCrash(runId, "before:step3");

      // STEP 3 — summarize. Diverges per trajectory so a fork is observable.
      const answer = await ctx.run(
        STEP.summarize.name,
        () =>
          recordStep({
            runId,
            seq: STEP.summarize.seq,
            stepName: STEP.summarize.name,
            kind: "summarize",
            sideEffect: false,
            producer: () =>
              `answer[${trajectory}]<<${plan}|${toolResult}|prompt=${input.prompt}>>`,
          }).value,
      );

      maybeCrash(runId, "after:step3");

      return { runId, trajectory, plan, toolResult, answer };
    },
  },
});

export type AgentRunService = typeof agentRun;

if (process.env.DURABL_SERVE === "1" || process.argv[1]?.endsWith("service.js")) {
  restate.serve({ services: [agentRun], port: config.servicePort });
}
