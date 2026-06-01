// ─────────────────────────────────────────────────────────────────────────────
// STEP MODEL — the neutral, substrate-agnostic vocabulary of a run.
//
// These types are deliberately free of any Restate/DBOS/Cloudflare detail. They
// are the portable surface that M2 (replay/time-travel UI) and M3 (logical fork)
// build on. Nothing here imports the substrate SDK.
// ─────────────────────────────────────────────────────────────────────────────

import type { IdempotencyKey } from "./idempotency.js";

/** Journal schema version. Bump on any breaking change to the record shape. */
export const JOURNAL_SCHEMA_VERSION = 1 as const;

/**
 * Kind of a journaled step. Neutral across providers/frameworks.
 *
 * M5 adds two HITL kinds. They are ordinary journaled steps — they reuse the
 * SAME idempotency/replay contract as every other step:
 *   - `hitl_pause`: records that the run durably suspended awaiting human input.
 *     Its presence in the journal IS the durable "paused" state (not in memory).
 *   - `hitl_input`: records the human-supplied input exactly once, keyed
 *     `runId:<stepName>`; supplying input twice dedups to one logical step.
 */
export type StepKind =
  | "plan"
  | "tool_call"
  | "summarize"
  | "hitl_pause"
  | "hitl_input";

/**
 * One immutable journal entry: the recorded OUTPUT of a single logical step in a
 * run, keyed by (runId, seq). `output` is JSON-serializable. `sideEffect` flags
 * steps that touched the outside world (the ones the idempotency contract
 * protects). `seededFrom` is set when this entry was copied in by a logical fork.
 */
export interface JournalEntry {
  readonly schema: typeof JOURNAL_SCHEMA_VERSION;
  readonly runId: string;
  readonly seq: number;
  readonly stepName: string;
  readonly kind: StepKind;
  /** Deterministic idempotency key for this step (runId:stepName). */
  readonly idemKey: IdempotencyKey;
  /** JSON value produced by the step. */
  readonly output: unknown;
  readonly sideEffect: boolean;
  /** Source runId if this entry was seeded by a fork; null for native steps. */
  readonly seededFrom: string | null;
  readonly recordedAt: string;
}

/** Run-level metadata: lineage for the fork wedge, plus a trajectory label. */
export interface RunMeta {
  readonly schema: typeof JOURNAL_SCHEMA_VERSION;
  readonly runId: string;
  readonly parentRun: string | null;
  readonly forkedAtSeq: number | null;
  readonly trajectory: string;
  readonly createdAt: string;
}

/** Input to the M1 reference workflow. */
export interface WorkflowInput {
  readonly prompt: string;
  readonly trajectory?: string;
}

/** Output of the M1 reference workflow. */
export interface WorkflowOutput {
  readonly runId: string;
  readonly trajectory: string;
  readonly plan: string;
  readonly toolResult: string;
  readonly answer: string;
}

/** Input to the M5 HITL reference workflow (same shape as the M1 input). */
export interface HitlWorkflowInput {
  readonly prompt: string;
  readonly trajectory?: string;
}

/**
 * Human input supplied to resume a paused HITL run. `decision` is the operator's
 * answer; it is journaled (exactly once) and folded into the post-resume steps.
 */
export interface HitlInput {
  readonly decision: string;
}

/** Output of the M5 HITL reference workflow. */
export interface HitlWorkflowOutput {
  readonly runId: string;
  readonly trajectory: string;
  readonly plan: string;
  /** The human decision that was supplied to resume the run. */
  readonly humanDecision: string;
  readonly toolResult: string;
  readonly answer: string;
}
