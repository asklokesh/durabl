// Smallest durable agent loop: Restate ctx.run + durabl recordStep + fireEffect.
// Mirrors src/workflow.ts with two steps (prepare → side-effecting act).

import * as restate from "@restatedev/restate-sdk";
import { config } from "#durabl/config.js";
import { fireEffect } from "#durabl/effect-sink.js";
import { ensureRunMeta, recordStep } from "#durabl/journal.js";

const STEP = {
  prepare: { seq: 1, name: "step1-prepare" },
  act: { seq: 2, name: "step2-act" },
} as const;

export interface MinimalInput { readonly prompt: string; }
export interface MinimalOutput { readonly runId: string; readonly prepared: string; readonly acted: string; }

export const minimalRun = restate.workflow({
  name: "MinimalRun",
  handlers: {
    run: async (ctx: restate.WorkflowContext, input: MinimalInput): Promise<MinimalOutput> => {
      const runId = ctx.key;
      ensureRunMeta(runId, "main");
      const prepared = await ctx.run(STEP.prepare.name, () =>
        recordStep({ runId, seq: STEP.prepare.seq, stepName: STEP.prepare.name, kind: "plan", sideEffect: false,
          producer: () => `prepared(${input.prompt})` }).value);
      const acted = await ctx.run(STEP.act.name, () =>
        recordStep({ runId, seq: STEP.act.seq, stepName: STEP.act.name, kind: "tool_call", sideEffect: true,
          producer: (idemKey) => {
            const fired = fireEffect({ runId, trajectory: "main", stepName: STEP.act.name, idemKey, payload: { prepared } });
            return `acted(effectId=${fired.id})`;
          } }).value);
      return { runId, prepared, acted };
    },
  },
});

export type MinimalRunService = typeof minimalRun;
if (process.env.DURABL_MINIMAL_SERVE === "1" || process.argv[1]?.endsWith("workflow.js")) {
  restate.serve({ services: [minimalRun], port: config.servicePort });
}
