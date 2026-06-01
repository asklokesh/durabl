// ─────────────────────────────────────────────────────────────────────────────
// SOURCE-PARAMETERIZED INSPECTION (M3) — fork tree + diff over ANY JournalSource.
//
// inspect.ts (M2) reads the live SQLite journal directly. M3's web read surface
// must serve EITHER the live journal OR a journal imported from a portable JSONL
// export (no substrate). These helpers re-implement the same lineage/tree/diff
// logic against the JournalSource interface, so the identical UI works offline
// from an export. The shapes match inspect.ts exactly (drop-in for the UI).
// ─────────────────────────────────────────────────────────────────────────────

import type { JournalSource } from "./journal-source.js";
import type { RunMeta } from "./step-model.js";
import type {
  ForkTreeNode,
  LineageNode,
  StepDiff,
  StepDiffStatus,
  TrajectoryDiff,
} from "./inspect.js";

/** Lineage chain root→…→run over a JournalSource. Cycle-guarded. */
export function lineageFrom(source: JournalSource, runId: string): LineageNode[] {
  const chain: LineageNode[] = [];
  const seen = new Set<string>();
  let cur: string | null = runId;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const m = source.runMeta(cur);
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

/** Direct child forks of a run over a JournalSource. */
export function listForksFrom(source: JournalSource, runId: string): RunMeta[] {
  return source.childRuns(runId);
}

/** Whole descendant fork tree rooted at `rootId` over a JournalSource. */
export function forkTreeFrom(
  source: JournalSource,
  rootId: string,
  seen = new Set<string>(),
): ForkTreeNode {
  const m = source.runMeta(rootId);
  const node: ForkTreeNode = {
    runId: rootId,
    trajectory: m?.trajectory ?? "(unknown)",
    forkedAtSeq: m?.forkedAtSeq ?? null,
    children: [],
  };
  if (seen.has(rootId) || seen.size > 10000) return node;
  seen.add(rootId);
  for (const c of source.childRuns(rootId)) {
    node.children.push(forkTreeFrom(source, c.runId, seen));
  }
  return node;
}

/** Per-seq trajectory diff over a JournalSource (same semantics as inspect.ts). */
export function diffTrajectoriesFrom(
  source: JournalSource,
  runA: string,
  runB: string,
): TrajectoryDiff {
  const a = source.trajectory(runA);
  const b = source.trajectory(runB);
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

/** Roots of the fork forest in a source (runs with no parent). */
export function rootRuns(source: JournalSource): string[] {
  return source
    .allRunIds()
    .filter((id) => (source.runMeta(id)?.parentRun ?? null) === null);
}
