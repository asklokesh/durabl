// ─────────────────────────────────────────────────────────────────────────────
// PORTABLE STEP JOURNAL — the durabl product surface.
//
// A structured, substrate-agnostic record of each step's output, keyed by
// (runId, seq), stored in plain SQLite (zero native deps via node:sqlite) and
// trivially exportable to JSONL. The substrate (Restate) provides crash
// durability for PRODUCING entries; this journal provides PORTABILITY, the
// enforced IDEMPOTENCY contract, and the substrate for LOGICAL FORK (M3).
//
// Source-of-truth note (M0 §5): the substrate journal and this app journal are
// two stores. This journal is the *portable export* surface; it short-circuits
// re-execution at the app layer (idempotent recordStep), while the substrate
// guarantees crash durability. Both must agree on a step's output — they do,
// because the output is produced once inside the substrate's durable step and
// recorded here under the same deterministic key.
// ─────────────────────────────────────────────────────────────────────────────

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";
import {
  asIdempotencyKey,
  deriveIdempotencyKey,
  type IdempotencyKey,
} from "./idempotency.js";
import {
  JOURNAL_SCHEMA_VERSION,
  type JournalEntry,
  type RunMeta,
  type StepKind,
} from "./step-model.js";

function open(): DatabaseSync {
  mkdirSync(dirname(config.journalDbPath), { recursive: true });
  const d = new DatabaseSync(config.journalDbPath);
  d.exec("PRAGMA journal_mode = WAL");
  d.exec("PRAGMA busy_timeout = 5000");
  d.exec("PRAGMA foreign_keys = ON");
  d.exec(`
    CREATE TABLE IF NOT EXISTS step_journal (
      schema      INTEGER NOT NULL,
      run_id      TEXT NOT NULL,
      seq         INTEGER NOT NULL,
      step_name   TEXT NOT NULL,
      kind        TEXT NOT NULL,
      idem_key    TEXT NOT NULL,
      output      TEXT NOT NULL,
      side_effect INTEGER NOT NULL DEFAULT 0,
      seeded_from TEXT,
      recorded_at TEXT NOT NULL,
      PRIMARY KEY (run_id, seq)
    );
    -- Per-run uniqueness of the deterministic idempotency key: a logical step
    -- can be journaled at most once per run. Structural enforcement of the
    -- exactly-once contract at the journal layer (mirrors the effect sink).
    CREATE UNIQUE INDEX IF NOT EXISTS step_journal_idem
      ON step_journal (run_id, idem_key);

    CREATE TABLE IF NOT EXISTS run_meta (
      schema        INTEGER NOT NULL,
      run_id        TEXT PRIMARY KEY,
      parent_run    TEXT,
      forked_at_seq INTEGER,
      trajectory    TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );
  `);
  return d;
}

interface RawStepRow {
  schema: number;
  run_id: string;
  seq: number;
  step_name: string;
  kind: string;
  idem_key: string;
  output: string;
  side_effect: number;
  seeded_from: string | null;
  recorded_at: string;
}

function hydrate(r: RawStepRow): JournalEntry {
  return {
    schema: JOURNAL_SCHEMA_VERSION,
    runId: r.run_id,
    seq: r.seq,
    stepName: r.step_name,
    kind: r.kind as StepKind,
    idemKey: asIdempotencyKey(r.idem_key),
    output: JSON.parse(r.output) as unknown,
    sideEffect: r.side_effect === 1,
    seededFrom: r.seeded_from,
    recordedAt: r.recorded_at,
  };
}

/** Result of {@link recordStep}: the step value plus whether it was replayed. */
export interface RecordResult<T> {
  readonly value: T;
  readonly replayed: boolean;
  readonly idemKey: IdempotencyKey;
}

/**
 * Append-or-replay a step, structurally idempotent.
 *
 * If (runId, seq) is already journaled, the stored output is returned WITHOUT
 * running `producer` (replay / fork short-circuit) — so a side effect inside
 * `producer` never re-fires for an already-recorded step. Otherwise `producer`
 * runs once, its output is journaled under the deterministic idempotency key,
 * and the value is returned.
 *
 * The idempotency key is DERIVED HERE from (runId, stepName) and passed to the
 * producer, so the only key a step can use for its side effect is the canonical
 * one. This is what makes idempotency non-optional.
 */
export function recordStep<T>(args: {
  runId: string;
  seq: number;
  stepName: string;
  kind: StepKind;
  sideEffect: boolean;
  producer: (idemKey: IdempotencyKey) => T;
}): RecordResult<T> {
  const idemKey = deriveIdempotencyKey(args.runId, args.stepName);
  const d = open();
  try {
    const existing = d
      .prepare(`SELECT output FROM step_journal WHERE run_id = ? AND seq = ?`)
      .get(args.runId, args.seq) as { output: string } | undefined;
    if (existing) {
      return {
        value: JSON.parse(existing.output) as T,
        replayed: true,
        idemKey,
      };
    }

    const value = args.producer(idemKey);

    d.prepare(
      `INSERT INTO step_journal
         (schema, run_id, seq, step_name, kind, idem_key, output, side_effect, seeded_from, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    ).run(
      JOURNAL_SCHEMA_VERSION,
      args.runId,
      args.seq,
      args.stepName,
      args.kind,
      idemKey,
      JSON.stringify(value),
      args.sideEffect ? 1 : 0,
      new Date().toISOString(),
    );
    return { value, replayed: false, idemKey };
  } finally {
    d.close();
  }
}

export function getEntry(runId: string, seq: number): JournalEntry | undefined {
  const d = open();
  try {
    const r = d
      .prepare(`SELECT * FROM step_journal WHERE run_id = ? AND seq = ?`)
      .get(runId, seq) as RawStepRow | undefined;
    return r ? hydrate(r) : undefined;
  } finally {
    d.close();
  }
}

/** The full ordered step sequence for a run. */
export function trajectory(runId: string): JournalEntry[] {
  const d = open();
  try {
    const rows = d
      .prepare(`SELECT * FROM step_journal WHERE run_id = ? ORDER BY seq`)
      .all(runId) as unknown as RawStepRow[];
    return rows.map(hydrate);
  } finally {
    d.close();
  }
}

export function ensureRunMeta(runId: string, trajectoryLabel: string): void {
  const d = open();
  try {
    d.prepare(
      `INSERT OR IGNORE INTO run_meta
         (schema, run_id, parent_run, forked_at_seq, trajectory, created_at)
       VALUES (?, ?, NULL, NULL, ?, ?)`,
    ).run(JOURNAL_SCHEMA_VERSION, runId, trajectoryLabel, new Date().toISOString());
  } finally {
    d.close();
  }
}

export function runMeta(runId: string): RunMeta | undefined {
  const d = open();
  try {
    const r = d.prepare(`SELECT * FROM run_meta WHERE run_id = ?`).get(runId) as
      | {
          schema: number;
          run_id: string;
          parent_run: string | null;
          forked_at_seq: number | null;
          trajectory: string;
          created_at: string;
        }
      | undefined;
    if (!r) return undefined;
    return {
      schema: JOURNAL_SCHEMA_VERSION,
      runId: r.run_id,
      parentRun: r.parent_run,
      forkedAtSeq: r.forked_at_seq,
      trajectory: r.trajectory,
      createdAt: r.created_at,
    };
  } finally {
    d.close();
  }
}

/**
 * LOGICAL STEP-LEVEL FORK (M3 foundation; exercised by the M1 gate).
 *
 * Seed `newRunId` from `sourceRunId`'s journal up to (and including) `throughSeq`,
 * copying outputs verbatim and marking them `seeded_from = sourceRunId`. Because
 * the seeded entries already exist, {@link recordStep} short-circuits them on the
 * new run — the side effect of a seeded step does NOT re-fire. The new run then
 * diverges past `throughSeq`. Transactional: all-or-nothing.
 *
 * Note: each forked entry keeps the SOURCE run's stored idem_key value, but it
 * is stored under the NEW run_id, so the (run_id, idem_key) unique index is not
 * violated and the new run's later native steps derive fresh keys from newRunId.
 */
export function forkRun(args: {
  sourceRunId: string;
  newRunId: string;
  throughSeq: number;
  newTrajectory: string;
}): number {
  const d = open();
  try {
    const rows = d
      .prepare(
        `SELECT * FROM step_journal WHERE run_id = ? AND seq <= ? ORDER BY seq`,
      )
      .all(args.sourceRunId, args.throughSeq) as unknown as RawStepRow[];

    const insertMeta = d.prepare(
      `INSERT OR REPLACE INTO run_meta
         (schema, run_id, parent_run, forked_at_seq, trajectory, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertStep = d.prepare(
      `INSERT INTO step_journal
         (schema, run_id, seq, step_name, kind, idem_key, output, side_effect, seeded_from, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = new Date().toISOString();

    d.exec("BEGIN");
    try {
      insertMeta.run(
        JOURNAL_SCHEMA_VERSION,
        args.newRunId,
        args.sourceRunId,
        args.throughSeq,
        args.newTrajectory,
        now,
      );
      for (const e of rows) {
        insertStep.run(
          JOURNAL_SCHEMA_VERSION,
          args.newRunId,
          e.seq,
          e.step_name,
          e.kind,
          e.idem_key,
          e.output,
          e.side_effect,
          args.sourceRunId,
          now,
        );
      }
      d.exec("COMMIT");
    } catch (err) {
      d.exec("ROLLBACK");
      throw err;
    }
    return rows.length;
  } finally {
    d.close();
  }
}

/**
 * Export a run's trajectory as neutral JSONL — substrate-detail-free. This is
 * the "your journal, in your infra, exportable" surface. Each line is a
 * {@link JournalEntry}; no Restate/engine fields leak.
 */
export function exportJsonl(runId: string): string {
  return trajectory(runId)
    .map((e) => JSON.stringify(e))
    .join("\n");
}

/** Test/harness utility: wipe the journal. Never call in production paths. */
export function resetJournal(): void {
  const d = open();
  try {
    d.exec(`DELETE FROM step_journal; DELETE FROM run_meta;`);
  } finally {
    d.close();
  }
}
