// ─────────────────────────────────────────────────────────────────────────────
// TRAJECTORY INSPECTION — read-only surface over the portable journal (M2).
//
// This is the programmatic read API behind the CLI and (later, M3) the replay
// UI. It is strictly READ-ONLY: it never fires effects, never invokes the
// substrate, never mutates the journal. Everything here is reconstructable from
// the neutral journal alone (no Restate/engine fields), which is the whole point
// of the portable journal — both a run and any fork of it can be inspected
// independently, off the same store, even after export.
//
// Surface:
//   inspectRun(runId)           → trajectory + lineage + effects for one run
//   lineage(runId)              → the divergence chain back to the root
//   listForks(runId)            → direct child forks of a run
//   forkTree(rootId)            → the whole descendant tree of a run
//   diffTrajectories(a, b)      → per-seq divergence between two trajectories
// ─────────────────────────────────────────────────────────────────────────────

import { childRuns, runMeta, trajectory } from "./journal.js";
import { effectsFor, type EffectRow } from "./effect-sink.js";
import type { JournalEntry, RunMeta } from "./step-model.js";

/** A single side effect as seen by the inspection surface (neutral subset). */
export interface EffectView {
  readonly id: number;
  readonly stepName: string;
  readonly idemKey: string;
  readonly firedAt: string;
  readonly payload: unknown;
}

function viewEffect(r: EffectRow): EffectView {
  return {
    id: r.id,
    stepName: r.step_name,
    idemKey: r.idem_key,
    firedAt: r.fired_at,
    payload: JSON.parse(r.payload) as unknown,
  };
}

/** A fully inspectable view of one run, reconstructed from the journal alone. */
export interface RunInspection {
  readonly runId: string;
  /** Run-level metadata incl. fork lineage; undefined only for unknown runs. */
  readonly meta: RunMeta | undefined;
  /** Ordered step sequence (the trajectory). */
  readonly steps: readonly JournalEntry[];
  /** Side effects actually fired BY this run (not seeded/inherited ones). */
  readonly effects: readonly EffectView[];
  /** Steps seeded in by a fork (seq <= divergence point); not re-executed. */
  readonly seededSeqs: readonly number[];
  /** The divergence point if this run is a fork (its forkedAtSeq), else null. */
  readonly divergedAtSeq: number | null;
  /** Direct child forks of this run. */
  readonly forks: readonly RunMeta[];
}

/**
 * Reconstruct everything inspectable about a single run from the journal.
 * Read-only. Works for a root run or any fork, independently.
 */
export function inspectRun(runId: string): RunInspection {
  const meta = runMeta(runId);
  const steps = trajectory(runId);
  const effects = effectsFor(runId).map(viewEffect);
  const seededSeqs = steps.filter((s) => s.seededFrom !== null).map((s) => s.seq);
  return {
    runId,
    meta,
    steps,
    effects,
    seededSeqs,
    divergedAtSeq: meta?.forkedAtSeq ?? null,
    forks: childRuns(runId),
  };
}

/** One hop in a lineage chain: a run and where it diverged from its parent. */
export interface LineageNode {
  readonly runId: string;
  readonly trajectory: string;
  readonly parentRun: string | null;
  readonly forkedAtSeq: number | null;
}

/**
 * The lineage chain for `runId`, ROOT first, ending at `runId`. Each node
 * records where it diverged from its parent. Cycle-guarded (a corrupt
 * parent-pointer loop cannot hang the inspector).
 */
export function lineage(runId: string): LineageNode[] {
  const chain: LineageNode[] = [];
  const seen = new Set<string>();
  let cur: string | null = runId;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const m = runMeta(cur);
    if (!m) break;
    chain.push({
      runId: m.runId,
      trajectory: m.trajectory,
      parentRun: m.parentRun,
      forkedAtSeq: m.forkedAtSeq,
    });
    cur = m.parentRun;
  }
  return chain.reverse();
}

/** Direct child forks of a run (one level). */
export function listForks(runId: string): RunMeta[] {
  return childRuns(runId);
}

/** A node in the descendant fork tree of a run. */
export interface ForkTreeNode {
  readonly runId: string;
  readonly trajectory: string;
  readonly forkedAtSeq: number | null;
  readonly children: ForkTreeNode[];
}

/**
 * The whole descendant tree rooted at `rootId` (forks of forks of forks...).
 * Cycle-guarded; depth-bounded defensively against a corrupt store.
 */
export function forkTree(rootId: string, _seen = new Set<string>()): ForkTreeNode {
  const m = runMeta(rootId);
  const node: ForkTreeNode = {
    runId: rootId,
    trajectory: m?.trajectory ?? "(unknown)",
    forkedAtSeq: m?.forkedAtSeq ?? null,
    children: [],
  };
  if (_seen.has(rootId) || _seen.size > 10000) return node;
  _seen.add(rootId);
  for (const c of childRuns(rootId)) {
    node.children.push(forkTree(c.runId, _seen));
  }
  return node;
}

/** Per-seq comparison of two trajectories. */
export type StepDiffStatus = "same" | "changed" | "only_a" | "only_b";

export interface StepDiff {
  readonly seq: number;
  readonly status: StepDiffStatus;
  readonly stepName: string;
  readonly aOutput?: unknown;
  readonly bOutput?: unknown;
  /** true if this seq is at-or-before both runs' divergence and was seeded. */
  readonly seeded: boolean;
}

export interface TrajectoryDiff {
  readonly runA: string;
  readonly runB: string;
  /** The first seq at which the two trajectories differ, or null if identical. */
  readonly firstDivergenceSeq: number | null;
  readonly steps: readonly StepDiff[];
}

/**
 * Diff two trajectories step-by-seq. Identifies the first divergence point and,
 * for shared seqs, whether the step output is identical (shared/seeded prefix)
 * or changed (the actual divergence). Pure read over the journal.
 */
export function diffTrajectories(runA: string, runB: string): TrajectoryDiff {
  const a = trajectory(runA);
  const b = trajectory(runB);
  const bySeqA = new Map(a.map((e) => [e.seq, e]));
  const bySeqB = new Map(b.map((e) => [e.seq, e]));
  const seqs = [...new Set([...bySeqA.keys(), ...bySeqB.keys()])].sort((x, y) => x - y);

  const steps: StepDiff[] = [];
  let firstDivergenceSeq: number | null = null;

  for (const seq of seqs) {
    const ea = bySeqA.get(seq);
    const eb = bySeqB.get(seq);
    let status: StepDiffStatus;
    if (ea && eb) {
      status = JSON.stringify(ea.output) === JSON.stringify(eb.output) ? "same" : "changed";
    } else if (ea) {
      status = "only_a";
    } else {
      status = "only_b";
    }
    if (status !== "same" && firstDivergenceSeq === null) firstDivergenceSeq = seq;
    steps.push({
      seq,
      status,
      stepName: (ea ?? eb)!.stepName,
      aOutput: ea?.output,
      bOutput: eb?.output,
      seeded: (ea?.seededFrom ?? null) !== null || (eb?.seededFrom ?? null) !== null,
    });
  }

  return { runA, runB, firstDivergenceSeq, steps };
}
