// THROWAWAY SPIKE CODE — not production.
//
// The NEUTRAL, PORTABLE step journal — this is the actual durabl artifact under
// test. It is a structured, substrate-agnostic record of each step's output,
// keyed by (runId, seq). It is stored in plain SQLite and is trivially
// exportable to JSONL. Restate provides crash durability for *producing* these
// entries; this journal provides PORTABILITY + the substrate for LOGICAL FORK.
//
// Logical step-level fork (per validation report Attack #1) = create a NEW run
// whose journal is seeded by COPYING the source run's step outputs up to seq N,
// then diverge. Seeded steps are replayed from the journal and their side
// effects are NOT re-fired.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const JOURNAL_DB_PATH =
  process.env.JOURNAL_DB_PATH ?? "/tmp/durabl-m0-spike/journal.db";

function db(): DatabaseSync {
  mkdirSync(dirname(JOURNAL_DB_PATH), { recursive: true });
  const d = new DatabaseSync(JOURNAL_DB_PATH);
  d.exec("PRAGMA journal_mode = WAL");
  d.exec("PRAGMA busy_timeout = 5000");
  d.exec(`
    CREATE TABLE IF NOT EXISTS step_journal (
      run_id     TEXT NOT NULL,
      seq        INTEGER NOT NULL,
      step_name  TEXT NOT NULL,
      output     TEXT NOT NULL,
      side_effect INTEGER NOT NULL DEFAULT 0,
      seeded_from TEXT,           -- source run id if this entry was forked-in
      recorded_at TEXT NOT NULL,
      PRIMARY KEY (run_id, seq)
    );
    CREATE TABLE IF NOT EXISTS run_meta (
      run_id      TEXT PRIMARY KEY,
      parent_run  TEXT,
      forked_at_seq INTEGER,
      trajectory  TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );
  `);
  return d;
}

export interface JournalEntry {
  run_id: string;
  seq: number;
  step_name: string;
  output: string; // JSON
  side_effect: number;
  seeded_from: string | null;
  recorded_at: string;
}

// Append-or-get-existing: if (runId, seq) already journaled, return the stored
// output (replay). Otherwise run producer, store, return. This is the
// application-level short-circuit that, combined with Restate's ctx.run,
// guarantees a seeded/forked step never re-fires its side effect.
export function recordOnce<T>(
  runId: string,
  seq: number,
  stepName: string,
  sideEffect: boolean,
  producer: () => T,
): { value: T; replayed: boolean } {
  const d = db();
  try {
    const existing = d
      .prepare(`SELECT output FROM step_journal WHERE run_id = ? AND seq = ?`)
      .get(runId, seq) as { output: string } | undefined;
    if (existing) {
      return { value: JSON.parse(existing.output) as T, replayed: true };
    }
    const value = producer();
    d.prepare(
      `INSERT INTO step_journal (run_id, seq, step_name, output, side_effect, seeded_from, recorded_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    ).run(
      runId,
      seq,
      stepName,
      JSON.stringify(value),
      sideEffect ? 1 : 0,
      new Date().toISOString(),
    );
    return { value, replayed: false };
  } finally {
    d.close();
  }
}

export function getEntry(runId: string, seq: number): JournalEntry | undefined {
  const d = db();
  try {
    return d
      .prepare(`SELECT * FROM step_journal WHERE run_id = ? AND seq = ?`)
      .get(runId, seq) as unknown as JournalEntry | undefined;
  } finally {
    d.close();
  }
}

export function trajectory(runId: string): JournalEntry[] {
  const d = db();
  try {
    return d
      .prepare(`SELECT * FROM step_journal WHERE run_id = ? ORDER BY seq`)
      .all(runId) as unknown as JournalEntry[];
  } finally {
    d.close();
  }
}

// LOGICAL FORK: seed newRunId from sourceRunId's journal up to (and including)
// seq=throughSeq. Copies outputs verbatim and marks them seeded so the forked
// run replays them from the journal instead of re-executing (no side-effect
// re-fire). Returns number of seeded entries.
export function forkRun(
  sourceRunId: string,
  newRunId: string,
  throughSeq: number,
  newTrajectory: string,
): number {
  const d = db();
  try {
    const rows = d
      .prepare(
        `SELECT * FROM step_journal WHERE run_id = ? AND seq <= ? ORDER BY seq`,
      )
      .all(sourceRunId, throughSeq) as unknown as JournalEntry[];
    const insert = d.prepare(
      `INSERT INTO step_journal (run_id, seq, step_name, output, side_effect, seeded_from, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = new Date().toISOString();
    d.exec("BEGIN");
    try {
      d.prepare(
        `INSERT OR REPLACE INTO run_meta (run_id, parent_run, forked_at_seq, trajectory, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(newRunId, sourceRunId, throughSeq, newTrajectory, now);
      for (const e of rows) {
        insert.run(
          newRunId,
          e.seq,
          e.step_name,
          e.output,
          e.side_effect,
          sourceRunId,
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

export function meta(runId: string):
  | { run_id: string; parent_run: string | null; forked_at_seq: number | null; trajectory: string; created_at: string }
  | undefined {
  const d = db();
  try {
    return d.prepare(`SELECT * FROM run_meta WHERE run_id = ?`).get(runId) as any;
  } finally {
    d.close();
  }
}

export function ensureMeta(runId: string, trajectoryLabel: string): void {
  const d = db();
  try {
    d.prepare(
      `INSERT OR IGNORE INTO run_meta (run_id, parent_run, forked_at_seq, trajectory, created_at)
       VALUES (?, NULL, NULL, ?, ?)`,
    ).run(runId, trajectoryLabel, new Date().toISOString());
  } finally {
    d.close();
  }
}

export function exportJsonl(runId: string): string {
  return trajectory(runId)
    .map((e) => JSON.stringify(e))
    .join("\n");
}

export function resetJournal(): void {
  const d = db();
  try {
    d.exec(`DELETE FROM step_journal; DELETE FROM run_meta;`);
  } finally {
    d.close();
  }
}
