// REST helpers for fork — thin wrappers over fork.ts.

import { config } from "./config.js";
import {
  forkAndRun,
  seedFork,
  validateForkPlan,
  ForkError,
  type ForkDecision,
  type ForkPlan,
} from "./fork.js";

export async function forkInvokeViaIngress(
  runId: string,
  decision: ForkDecision,
  ingress = config.restateIngress,
): Promise<unknown> {
  const res = await fetch(`${ingress}/AgentRun/${runId}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: decision.prompt, trajectory: decision.trajectory }),
  });
  if (!res.ok) {
    throw new Error(`invoke ${runId} failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

export interface ForkPostBody {
  readonly sourceRunId: string;
  readonly newRunId: string;
  readonly throughSeq: number;
  readonly prompt: string;
  readonly trajectory?: string;
  readonly seedOnly?: boolean;
  readonly validateOnly?: boolean;
}

export function parseForkPostBody(raw: unknown): ForkPostBody {
  const o = raw as Record<string, unknown>;
  const sourceRunId = typeof o.sourceRunId === "string" ? o.sourceRunId.trim() : "";
  const newRunId = typeof o.newRunId === "string" ? o.newRunId.trim() : "";
  const throughSeq = Number(o.throughSeq);
  const prompt = typeof o.prompt === "string" ? o.prompt : "";
  const trajectory = typeof o.trajectory === "string" ? o.trajectory.trim() : undefined;
  const seedOnly = o.seedOnly === true;
  const validateOnly = o.validateOnly === true;
  if (!sourceRunId || !newRunId) throw new ForkError("sourceRunId and newRunId required");
  if (!Number.isFinite(throughSeq) || throughSeq < 1) {
    throw new ForkError("throughSeq must be a positive integer");
  }
  if (!validateOnly && !seedOnly && !prompt) {
    throw new ForkError("prompt required unless seedOnly or validateOnly");
  }
  return { sourceRunId, newRunId, throughSeq, prompt, trajectory, seedOnly, validateOnly };
}

export function forkPlanFromBody(body: ForkPostBody): ForkPlan {
  const trajectory = body.trajectory ?? `fork-of-${body.sourceRunId}`;
  return {
    sourceRunId: body.sourceRunId,
    newRunId: body.newRunId,
    throughSeq: body.throughSeq,
    decision: { prompt: body.prompt || "(seed-only)", trajectory },
  };
}

export type ForkApiResult =
  | { readonly ok: true; readonly mode: "validate" }
  | { readonly ok: true; readonly mode: "seed"; readonly seededSteps: number }
  | { readonly ok: true; readonly mode: "fork"; readonly result: Awaited<ReturnType<typeof forkAndRun>> };

export async function executeForkPost(
  body: ForkPostBody,
  opts: { readonly live: boolean },
): Promise<ForkApiResult> {
  if (!opts.live) {
    throw new ForkOfflineError(
      "fork requires live mode (SQLite journal + Restate ingress for divergence)",
    );
  }
  const plan = forkPlanFromBody(body);
  if (body.validateOnly) {
    validateForkPlan(plan);
    return { ok: true, mode: "validate" };
  }
  if (body.seedOnly) {
    const seededSteps = seedFork(plan);
    return { ok: true, mode: "seed", seededSteps };
  }
  const result = await forkAndRun(plan, forkInvokeViaIngress);
  return { ok: true, mode: "fork", result };
}

export class ForkOfflineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForkOfflineError";
  }
}

export function forkApiErrorStatus(e: unknown): number {
  if (e instanceof ForkOfflineError) return 503;
  if (e instanceof ForkError) return 400;
  return 502;
}
