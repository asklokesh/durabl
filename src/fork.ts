// ─────────────────────────────────────────────────────────────────────────────
// FORK API — promote the M1 forkRun primitive into a product capability (M2).
//
// "Fork an agent's decision path from a chosen step N onto an alternate path."
//
// A fork is two operations:
//   1. SEED (pure, journal-only): copy the source run's journal entries seq <= N
//      into a new runId, marked seededFrom = source, with lineage recorded in
//      run_meta (parentRun, forkedAtSeq). This is forkRun() from M1.
//   2. DIVERGE (substrate): invoke the new run with a NEW input/decision. Because
//      the seeded steps already exist in the journal, recordStep() short-circuits
//      them — their side effects DO NOT re-fire (the M1 idempotency contract,
//      reused verbatim, NOT weakened). Only steps after N actually execute.
//
// This module owns fork ERGONOMICS + VALIDATION. It does not reimplement the
// durable core; it reuses recordStep/fireEffect/forkRun. The substrate invoke is
// injected (the `invoke` callback) so this stays neutral and testable: the CLI,
// the gate, and the e2e demo all supply the same ingress invoker.
// ─────────────────────────────────────────────────────────────────────────────

import { forkRun, getEntry, runMeta, trajectory } from "./journal.js";
import { deriveIdempotencyKey } from "./idempotency.js";

/** A new decision to apply on the forked path (drives divergence past N). */
export interface ForkDecision {
  /** New prompt/input for the diverged run. */
  readonly prompt: string;
  /** Trajectory label for the fork; must be unique-ish for observability. */
  readonly trajectory: string;
}

export interface ForkPlan {
  readonly sourceRunId: string;
  readonly newRunId: string;
  /** Fork point N: seed entries with seq <= throughSeq. */
  readonly throughSeq: number;
  readonly decision: ForkDecision;
}

export interface ForkResult {
  readonly sourceRunId: string;
  readonly newRunId: string;
  readonly forkedAtSeq: number;
  readonly seededSteps: number;
  /** The substrate invocation result of the diverged run (shape is workflow's). */
  readonly divergedResult: unknown;
}

export class ForkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForkError";
  }
}

/**
 * Validate a fork plan against the journal WITHOUT mutating anything.
 * Throws ForkError on any problem (unknown source, empty source, out-of-range
 * fork point, colliding target). Pure read.
 */
export function validateForkPlan(plan: ForkPlan): void {
  if (!plan.sourceRunId || !plan.newRunId) {
    throw new ForkError("fork requires both sourceRunId and newRunId");
  }
  if (plan.sourceRunId === plan.newRunId) {
    throw new ForkError("fork target must differ from source");
  }
  // newRunId becomes a Restate workflow key and an idempotency-key component;
  // enforce the same safe-identity contract the idempotency layer requires so a
  // fork can never produce a non-deterministic or unsafe key. (Throws if unsafe.)
  deriveIdempotencyKey(plan.newRunId, "probe");

  const src = trajectory(plan.sourceRunId);
  if (src.length === 0) {
    throw new ForkError(`source run ${plan.sourceRunId} has no journal entries`);
  }
  const maxSeq = src[src.length - 1]!.seq;
  if (plan.throughSeq < 1 || plan.throughSeq > maxSeq) {
    throw new ForkError(
      `fork point ${plan.throughSeq} out of range (source has seq 1..${maxSeq})`,
    );
  }
  if (!getEntry(plan.sourceRunId, plan.throughSeq)) {
    throw new ForkError(
      `source run ${plan.sourceRunId} has no step at seq ${plan.throughSeq}`,
    );
  }
  if (runMeta(plan.newRunId) || trajectory(plan.newRunId).length > 0) {
    throw new ForkError(`target run ${plan.newRunId} already exists`);
  }
}

/**
 * SEED step only (pure, journal-only, no substrate). Copies source entries
 * seq <= throughSeq into newRunId with lineage. Returns number of seeded steps.
 * Safe to call on the crash path (transactional all-or-nothing in forkRun).
 */
export function seedFork(plan: ForkPlan): number {
  validateForkPlan(plan);
  return forkRun({
    sourceRunId: plan.sourceRunId,
    newRunId: plan.newRunId,
    throughSeq: plan.throughSeq,
    newTrajectory: plan.decision.trajectory,
  });
}

/** Injected substrate invoker: run `runId` with the diverged decision. */
export type SubstrateInvoke = (
  runId: string,
  decision: ForkDecision,
) => Promise<unknown>;

/**
 * Full fork: seed (journal) then diverge (substrate). The seeded steps do not
 * re-fire their effects — that is guaranteed by the reused idempotency contract,
 * not by anything new here. Multi-level forks (fork of a fork) work because the
 * new run becomes a normal source whose own forkedAtSeq lineage chains back.
 */
export async function forkAndRun(
  plan: ForkPlan,
  invoke: SubstrateInvoke,
): Promise<ForkResult> {
  const seededSteps = seedFork(plan);
  const divergedResult = await invoke(plan.newRunId, plan.decision);
  return {
    sourceRunId: plan.sourceRunId,
    newRunId: plan.newRunId,
    forkedAtSeq: plan.throughSeq,
    seededSteps,
    divergedResult,
  };
}
