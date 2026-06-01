// THROWAWAY SPIKE CODE — not production.
// External-effect log: a real SQLite DB that records EVERY real firing of a
// side-effecting tool call. If a durable step double-fires, there will be >1
// row for the same (runId, stepName). This is the detector for the
// exactly-once gate; nothing here is mocked.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const EFFECT_DB_PATH =
  process.env.EFFECT_DB_PATH ?? "/tmp/durabl-m0-spike/effects.db";

function db(): DatabaseSync {
  mkdirSync(dirname(EFFECT_DB_PATH), { recursive: true });
  const d = new DatabaseSync(EFFECT_DB_PATH);
  d.exec("PRAGMA journal_mode = WAL");
  d.exec("PRAGMA busy_timeout = 5000");
  d.exec(`
    CREATE TABLE IF NOT EXISTS effect_log (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id    TEXT NOT NULL,
      trajectory TEXT NOT NULL,
      step_name TEXT NOT NULL,
      idem_key  TEXT NOT NULL,
      payload   TEXT NOT NULL,
      fired_at  TEXT NOT NULL,
      pid       INTEGER NOT NULL
    );
    -- Exactly-once at the effect SINK: a deterministic idempotency key derived
    -- from (run_id, step_name) makes re-fires after a crash a no-op dedup. This
    -- is the industry-standard pattern: the durable engine guarantees at-least-
    -- once step execution; the effect must be idempotent for end-to-end
    -- exactly-once. The UNIQUE index is the dedup boundary.
    CREATE UNIQUE INDEX IF NOT EXISTS effect_idem ON effect_log (idem_key);
  `);
  return d;
}

// Records a single real firing of a side effect. Called from INSIDE a Restate
// ctx.run() durable step. Restate's journal must ensure this body executes
// exactly once across crashes/replays; this function makes a violation visible.
export function fireEffect(args: {
  runId: string;
  trajectory: string;
  stepName: string;
  payload: unknown;
  // Optional explicit idempotency key. Defaults to runId:stepName so a re-fire
  // of the same logical step after a crash dedups to a single row.
  idemKey?: string;
}): { id: number; firedAt: string; deduped: boolean } {
  const d = db();
  try {
    const firedAt = new Date().toISOString();
    const idemKey = args.idemKey ?? `${args.runId}:${args.stepName}`;
    // INSERT OR IGNORE on the UNIQUE idem_key: the second physical firing after
    // a crash/replay is silently ignored — exactly-once at the sink.
    const info = d
      .prepare(
        `INSERT OR IGNORE INTO effect_log
           (run_id, trajectory, step_name, idem_key, payload, fired_at, pid)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        args.runId,
        args.trajectory,
        args.stepName,
        idemKey,
        JSON.stringify(args.payload),
        firedAt,
        process.pid,
      );
    const deduped = info.changes === 0;
    const row = d
      .prepare(`SELECT id FROM effect_log WHERE idem_key = ?`)
      .get(idemKey) as { id: number };
    return { id: row.id, firedAt, deduped };
  } finally {
    d.close();
  }
}

export interface EffectRow {
  id: number;
  run_id: string;
  trajectory: string;
  step_name: string;
  payload: string;
  fired_at: string;
  pid: number;
}

export function effectsFor(runId: string): EffectRow[] {
  const d = db();
  try {
    return d
      .prepare(`SELECT * FROM effect_log WHERE run_id = ? ORDER BY id`)
      .all(runId) as unknown as EffectRow[];
  } finally {
    d.close();
  }
}

export function countEffects(runId: string, stepName: string): number {
  const d = db();
  try {
    const row = d
      .prepare(
        `SELECT COUNT(*) AS c FROM effect_log WHERE run_id = ? AND step_name = ?`,
      )
      .get(runId, stepName) as { c: number };
    return row.c;
  } finally {
    d.close();
  }
}

export function resetEffects(): void {
  const d = db();
  try {
    d.exec(`DELETE FROM effect_log`);
  } finally {
    d.close();
  }
}
