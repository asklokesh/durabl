// ─────────────────────────────────────────────────────────────────────────────
// REPLAY / RECONSTRUCTION ENGINE (M3) — the observability read surface.
//
// Reconstructs and "replays" a past run PURELY from its journal: the ordered
// step sequence (inputs/decisions, effects, timing, outcome), reconstructed from
// the portable journal — NOT from live Restate/substrate state.
//
// Substrate-independence is structural: this module reads everything through a
// JournalSource (journal-source.ts). The same code runs against the live SQLite
// journal AND against a journal imported from a JSONL export with nothing else
// running. Proving replay over an imported export == replay over the live
// journal is the portability gate.
//
// Capabilities:
//   reconstruct(source, runId)        → full ReplayedRun (steps, effects, state)
//   stateAt(source, runId, n)         → time-travel: state + effects AS OF step N
//   divergencePoints(source, runId)   → where forks branched off this run
//   assertReplayMatches(a, b)         → replay-divergence assertion (== none)
//
// Read-only. No effects. No substrate. No mutation.
// ─────────────────────────────────────────────────────────────────────────────

import type { JournalSource } from "./journal-source.js";
import type { JournalEntry, RunMeta } from "./step-model.js";

/** A single reconstructed step in a replayed run. */
export interface ReplayStep {
  readonly seq: number;
  readonly stepName: string;
  readonly kind: string;
  /** The recorded output of the step (the "decision"/result). */
  readonly output: unknown;
  readonly sideEffect: boolean;
  /** True if this step was seeded by a fork (replayed, not natively executed). */
  readonly seeded: boolean;
  /** Source run if seeded; null for native steps. */
  readonly seededFrom: string | null;
  readonly idemKey: string;
  readonly recordedAt: string;
  /** Milliseconds elapsed from the previous step's recordedAt (null for seq 1). */
  readonly elapsedMsFromPrev: number | null;
  /** Side effects fired at this step (matched by stepName). */
  readonly effects: ReplayEffect[];
}

/** A side effect as reconstructed from the journal/export. */
export interface ReplayEffect {
  readonly id: number;
  readonly stepName: string;
  readonly idemKey: string;
  readonly firedAt: string;
  readonly payload: unknown;
}

/** Where another run forked off this run (a divergence point). */
export interface DivergencePoint {
  /** The seq on THIS run at which a fork branched. */
  readonly seq: number;
  /** The forked run id. */
  readonly forkRunId: string;
  readonly forkTrajectory: string;
}

/** A fully reconstructed run — everything a replay UI / CLI renders. */
export interface ReplayedRun {
  readonly runId: string;
  readonly trajectory: string;
  readonly meta: RunMeta | undefined;
  readonly steps: readonly ReplayStep[];
  /** Total wall-clock span of the run (ms), from first to last recordedAt. */
  readonly totalElapsedMs: number;
  /** The run's final outcome (output of the last step), or null if empty. */
  readonly outcome: unknown;
  /** All side effects fired by this run, in order. */
  readonly effects: readonly ReplayEffect[];
  /** Points where forks branched off this run. */
  readonly divergencePoints: readonly DivergencePoint[];
  /** Where this run reconstructed FROM (origin string of the JournalSource). */
  readonly reconstructedFrom: string;
}

function elapsedMs(prev: string, cur: string): number | null {
  const a = Date.parse(prev);
  const b = Date.parse(cur);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return b - a;
}

/** Effects fired at a given step, matched by step name. */
function effectsAtStep(
  allEffects: ReplayEffect[],
  stepName: string,
): ReplayEffect[] {
  return allEffects.filter((e) => e.stepName === stepName);
}

/**
 * Reconstruct a full run from a JournalSource. The returned object is the exact
 * data the replay UI/CLI renders: the step sequence (decisions + effects +
 * timing), the outcome, and where forks diverged.
 */
export function reconstruct(source: JournalSource, runId: string): ReplayedRun {
  const entries = source.trajectory(runId);
  const meta = source.runMeta(runId);
  const rawEffects = source.effectsFor(runId);
  const effects: ReplayEffect[] = rawEffects.map((r) => ({
    id: r.id,
    stepName: r.step_name,
    idemKey: r.idem_key,
    firedAt: r.fired_at,
    payload: safeParse(r.payload),
  }));

  const steps: ReplayStep[] = entries.map((e, i) => {
    const prev = i > 0 ? entries[i - 1]! : null;
    return {
      seq: e.seq,
      stepName: e.stepName,
      kind: e.kind,
      output: e.output,
      sideEffect: e.sideEffect,
      seeded: e.seededFrom !== null,
      seededFrom: e.seededFrom,
      idemKey: e.idemKey,
      recordedAt: e.recordedAt,
      elapsedMsFromPrev: prev ? elapsedMs(prev.recordedAt, e.recordedAt) : null,
      effects: effectsAtStep(effects, e.stepName),
    };
  });

  const totalElapsedMs =
    entries.length >= 2
      ? elapsedMs(entries[0]!.recordedAt, entries[entries.length - 1]!.recordedAt) ?? 0
      : 0;

  return {
    runId,
    trajectory: meta?.trajectory ?? "main",
    meta,
    steps,
    totalElapsedMs,
    outcome: entries.length > 0 ? entries[entries.length - 1]!.output : null,
    effects,
    divergencePoints: divergencePoints(source, runId),
    reconstructedFrom: source.origin,
  };
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/** Points where forks branched off `runId` (its direct children's fork seqs). */
export function divergencePoints(
  source: JournalSource,
  runId: string,
): DivergencePoint[] {
  return source
    .childRuns(runId)
    .filter((c) => c.forkedAtSeq !== null)
    .map((c) => ({
      seq: c.forkedAtSeq!,
      forkRunId: c.runId,
      forkTrajectory: c.trajectory,
    }))
    .sort((a, b) => a.seq - b.seq || (a.forkRunId < b.forkRunId ? -1 : 1));
}

// ─── Time-travel ──────────────────────────────────────────────────────────────

/** State + effects of a run AS OF step N (inclusive). The time-travel view. */
export interface StateAsOf {
  readonly runId: string;
  /** The step index travelled to (1-based, inclusive). */
  readonly n: number;
  /** The maximum seq available for this run. */
  readonly maxSeq: number;
  /** Steps with seq <= n (what had happened by step N). */
  readonly steps: readonly ReplayStep[];
  /** The output of step N (the "current state" at that point), or null. */
  readonly currentOutput: unknown;
  /** Side effects fired at or before step N. */
  readonly effects: readonly ReplayEffect[];
  /** Forks that had already diverged at or before step N. */
  readonly divergedSoFar: readonly DivergencePoint[];
  readonly reconstructedFrom: string;
}

/**
 * Time-travel: reconstruct the run state and effect set AS OF step N (inclusive).
 * Throws if N is out of range. Pure read over the journal — the same answer from
 * a live journal or an imported export.
 */
export function stateAt(
  source: JournalSource,
  runId: string,
  n: number,
): StateAsOf {
  const full = reconstruct(source, runId);
  const maxSeq = full.steps.length > 0 ? full.steps[full.steps.length - 1]!.seq : 0;
  if (!Number.isInteger(n) || n < 1 || n > maxSeq) {
    throw new Error(
      `time-travel target step ${n} out of range (run ${runId} has steps 1..${maxSeq})`,
    );
  }
  const steps = full.steps.filter((s) => s.seq <= n);
  const effects = full.effects.filter((e) => {
    // an effect belongs to a step at seq <= n if its step is within the prefix
    return steps.some((s) => s.stepName === e.stepName);
  });
  const currentStep = steps.find((s) => s.seq === n);
  return {
    runId,
    n,
    maxSeq,
    steps,
    currentOutput: currentStep?.output ?? null,
    effects,
    divergedSoFar: full.divergencePoints.filter((d) => d.seq <= n),
    reconstructedFrom: source.origin,
  };
}

// ─── Replay-divergence assertion (the correctness gate) ───────────────────────

/** The result of comparing two reconstructions of the "same" run. */
export interface ReplayDivergence {
  /** True if the two reconstructions are byte-identical in step seq+output+effects. */
  readonly identical: boolean;
  /** Human-readable list of differences (empty when identical). */
  readonly differences: string[];
  readonly stepsA: number;
  readonly stepsB: number;
}

/**
 * Assert that a reconstruction `b` (e.g. replayed from an imported export with NO
 * substrate) EXACTLY matches reconstruction `a` (e.g. the live journal of the
 * run that actually happened). "Replay-divergence = none" means identical step
 * sequence, identical per-step output, and identical effect set.
 *
 * This is the M3 correctness gate: prove the replay reproduces what actually
 * happened, and prove the offline-from-export replay reproduces the live one.
 */
export function assertReplayMatches(
  a: ReplayedRun,
  b: ReplayedRun,
): ReplayDivergence {
  const differences: string[] = [];

  if (a.steps.length !== b.steps.length) {
    differences.push(
      `step count differs: a=${a.steps.length} b=${b.steps.length}`,
    );
  }
  const n = Math.max(a.steps.length, b.steps.length);
  for (let i = 0; i < n; i++) {
    const sa = a.steps[i];
    const sb = b.steps[i];
    if (!sa || !sb) {
      differences.push(`step index ${i} present on only one side`);
      continue;
    }
    if (sa.seq !== sb.seq) differences.push(`seq mismatch at ${i}: ${sa.seq} vs ${sb.seq}`);
    if (sa.stepName !== sb.stepName)
      differences.push(`stepName mismatch at seq ${sa.seq}: ${sa.stepName} vs ${sb.stepName}`);
    if (sa.kind !== sb.kind)
      differences.push(`kind mismatch at seq ${sa.seq}: ${sa.kind} vs ${sb.kind}`);
    if (JSON.stringify(sa.output) !== JSON.stringify(sb.output))
      differences.push(
        `output mismatch at seq ${sa.seq}: ${JSON.stringify(sa.output)} vs ${JSON.stringify(sb.output)}`,
      );
    if (sa.idemKey !== sb.idemKey)
      differences.push(`idemKey mismatch at seq ${sa.seq}: ${sa.idemKey} vs ${sb.idemKey}`);
  }

  // Effect-set comparison (by idemKey + payload; ignore auto-increment id and
  // pid, which legitimately differ across stores — correctness is the logical
  // effect set, not the physical row id).
  const ea = a.effects
    .map((e) => `${e.idemKey}|${JSON.stringify(e.payload)}`)
    .sort();
  const eb = b.effects
    .map((e) => `${e.idemKey}|${JSON.stringify(e.payload)}`)
    .sort();
  if (JSON.stringify(ea) !== JSON.stringify(eb)) {
    differences.push(`effect set differs: a=${JSON.stringify(ea)} b=${JSON.stringify(eb)}`);
  }

  return {
    identical: differences.length === 0,
    differences,
    stepsA: a.steps.length,
    stepsB: b.steps.length,
  };
}

/** Convenience: reconstruct `runId` from both sources and assert they match. */
export function compareSources(
  liveSource: JournalSource,
  importedSource: JournalSource,
  runId: string,
): ReplayDivergence {
  return assertReplayMatches(
    reconstruct(liveSource, runId),
    reconstruct(importedSource, runId),
  );
}

/** Re-export for callers building the read surface. */
export type { JournalEntry };
