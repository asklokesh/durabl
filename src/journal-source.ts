// ─────────────────────────────────────────────────────────────────────────────
// JOURNAL SOURCE — the substrate-independence boundary for M3 replay.
//
// The replay/reconstruction engine (replay.ts) reads a run ONLY through this
// interface. Two implementations exist:
//
//   1. liveJournalSource() — reads the local SQLite step journal (journal.ts).
//      This is the journal as produced by an M1/M2 run on the Restate substrate.
//   2. importJournalSource(jsonl) — reads an IN-MEMORY journal hydrated purely
//      from a portable JSONL export string. NO database, NO Restate, NO substrate.
//
// Because replay only ever sees a JournalSource, the identical reconstruction
// code runs against (a) a live journal and (b) a journal imported from an
// exported JSONL file with nothing else running. That is the portability proof:
// "your journal lives in your infra, portable, not a lab's" — reconstruct a run
// and its forks offline from the export alone.
//
// This module imports NOTHING from the substrate (Restate). It depends only on
// the neutral step-model and the journal read helpers.
// ─────────────────────────────────────────────────────────────────────────────

import {
  trajectory as liveTrajectory,
  runMeta as liveRunMeta,
  childRuns as liveChildRuns,
  allRunIds as liveAllRunIds,
} from "./journal.js";
import { effectsFor as liveEffectsFor, type EffectRow } from "./effect-sink.js";
import { asIdempotencyKey } from "./idempotency.js";
import {
  JOURNAL_SCHEMA_VERSION,
  type JournalEntry,
  type RunMeta,
  type StepKind,
} from "./step-model.js";

/**
 * A read-only view of a journal. The replay engine, inspection, and the web
 * read APIs all consume the journal exclusively through this interface, which is
 * why the engine cannot accidentally depend on the live substrate.
 */
export interface JournalSource {
  /** A label describing where this source's data came from (for evidence). */
  readonly origin: string;
  /** Ordered step sequence for a run. */
  trajectory(runId: string): JournalEntry[];
  /** Run-level metadata (lineage). */
  runMeta(runId: string): RunMeta | undefined;
  /** Direct child forks of a run. */
  childRuns(parentRunId: string): RunMeta[];
  /** Side effects fired by a run (may be empty for an export without effects). */
  effectsFor(runId: string): EffectRow[];
  /** All run ids known to this source. */
  allRunIds(): string[];
}

/** The live SQLite journal source (a run as produced on the substrate). */
export function liveJournalSource(): JournalSource {
  return {
    origin: "live-sqlite-journal",
    trajectory: liveTrajectory,
    runMeta: liveRunMeta,
    childRuns: liveChildRuns,
    effectsFor: liveEffectsFor,
    allRunIds: liveAllRunIds,
  };
}

// ─── In-memory journal hydrated from a portable JSONL export ──────────────────

/** A parsed portable export: steps + optional lineage meta + optional effects. */
export interface ImportedJournal {
  readonly steps: JournalEntry[];
  readonly metas: RunMeta[];
  readonly effects: EffectRow[];
}

interface BareStepLine {
  schema: number;
  runId: string;
  seq: number;
  stepName: string;
  kind: string;
  idemKey: string;
  output: unknown;
  sideEffect: boolean;
  seededFrom: string | null;
  recordedAt: string;
}

function hydrateStep(o: BareStepLine): JournalEntry {
  return {
    schema: JOURNAL_SCHEMA_VERSION,
    runId: String(o.runId),
    seq: Number(o.seq),
    stepName: String(o.stepName),
    kind: o.kind as StepKind,
    idemKey: asIdempotencyKey(String(o.idemKey)),
    output: o.output,
    sideEffect: Boolean(o.sideEffect),
    seededFrom: o.seededFrom ?? null,
    recordedAt: String(o.recordedAt),
  };
}

function hydrateMeta(o: Record<string, unknown>): RunMeta {
  return {
    schema: JOURNAL_SCHEMA_VERSION,
    runId: String(o["runId"]),
    parentRun: (o["parentRun"] as string | null) ?? null,
    forkedAtSeq:
      o["forkedAtSeq"] === null || o["forkedAtSeq"] === undefined
        ? null
        : Number(o["forkedAtSeq"]),
    trajectory: String(o["trajectory"] ?? "main"),
    createdAt: String(o["createdAt"] ?? ""),
  };
}

/**
 * Parse one or more concatenated portable JSONL exports into a single in-memory
 * journal. Accepts BOTH export shapes durabl already produces:
 *
 *   - bare M1 shape: one {@link JournalEntry} per line (no `record` tag).
 *   - tagged M2 shape: lines tagged `{"record":"run_meta",...}` and
 *     `{"record":"step",...}` (so fork lineage travels with the export).
 *   - optional `{"record":"effect",...}` lines (durabl export --meta --effects),
 *     so a fully offline replay can show the effect set without a sink.
 *
 * Blank lines are ignored. Unknown tagged records are skipped (forward-compat).
 * This is the substrate-independent import path: no DB, no Restate.
 */
export function parseExport(jsonl: string): ImportedJournal {
  const steps: JournalEntry[] = [];
  const metas: RunMeta[] = [];
  const effects: EffectRow[] = [];

  const lines = jsonl.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim();
    if (!raw) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch (e) {
      throw new Error(
        `invalid JSONL at line ${i + 1}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    const tag = obj["record"];
    if (tag === "run_meta") {
      metas.push(hydrateMeta(obj));
    } else if (tag === "step") {
      steps.push(hydrateStep(obj as unknown as BareStepLine));
    } else if (tag === "effect") {
      effects.push(hydrateEffect(obj));
    } else if (tag === undefined) {
      // bare M1 JournalEntry line
      steps.push(hydrateStep(obj as unknown as BareStepLine));
    }
    // else: unknown tagged record — skip for forward compatibility.
  }
  return { steps, metas, effects };
}

function hydrateEffect(o: Record<string, unknown>): EffectRow {
  return {
    id: Number(o["id"] ?? 0),
    run_id: String(o["runId"] ?? o["run_id"]),
    trajectory: String(o["trajectory"] ?? "main"),
    step_name: String(o["stepName"] ?? o["step_name"]),
    idem_key: String(o["idemKey"] ?? o["idem_key"]),
    payload: typeof o["payload"] === "string" ? (o["payload"] as string) : JSON.stringify(o["payload"] ?? null),
    fired_at: String(o["firedAt"] ?? o["fired_at"] ?? ""),
    pid: Number(o["pid"] ?? 0),
  };
}

/**
 * Build a {@link JournalSource} backed entirely by an imported export string.
 * This source NEVER touches SQLite or the substrate — it is the offline,
 * portable reconstruction surface. Pass one or more concatenated exports
 * (e.g. a run plus all its forks) and it reconstructs every run + the fork tree.
 */
export function importJournalSource(
  jsonl: string,
  origin = "imported-jsonl-export",
): JournalSource {
  const { steps, metas, effects } = parseExport(jsonl);

  const stepsByRun = new Map<string, JournalEntry[]>();
  for (const s of steps) {
    const arr = stepsByRun.get(s.runId) ?? [];
    arr.push(s);
    stepsByRun.set(s.runId, arr);
  }
  for (const arr of stepsByRun.values()) arr.sort((a, b) => a.seq - b.seq);

  const metaByRun = new Map<string, RunMeta>();
  for (const m of metas) metaByRun.set(m.runId, m);
  // A run can appear in the export via steps but lack an explicit run_meta line
  // (bare M1 export). Synthesize a minimal root meta so lineage/forks still work.
  for (const runId of stepsByRun.keys()) {
    if (!metaByRun.has(runId)) {
      const first = stepsByRun.get(runId)![0];
      metaByRun.set(runId, {
        schema: JOURNAL_SCHEMA_VERSION,
        runId,
        parentRun: null,
        forkedAtSeq: null,
        trajectory: "main",
        createdAt: first?.recordedAt ?? "",
      });
    }
  }

  const effectsByRun = new Map<string, EffectRow[]>();
  for (const e of effects) {
    const arr = effectsByRun.get(e.run_id) ?? [];
    arr.push(e);
    effectsByRun.set(e.run_id, arr);
  }
  for (const arr of effectsByRun.values()) arr.sort((a, b) => a.id - b.id);

  return {
    origin,
    trajectory: (runId) => stepsByRun.get(runId)?.slice() ?? [],
    runMeta: (runId) => metaByRun.get(runId),
    childRuns: (parentRunId) =>
      [...metaByRun.values()]
        .filter((m) => m.parentRun === parentRunId)
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)),
    effectsFor: (runId) => effectsByRun.get(runId)?.slice() ?? [],
    allRunIds: () =>
      [...metaByRun.values()]
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
        .map((m) => m.runId),
  };
}
