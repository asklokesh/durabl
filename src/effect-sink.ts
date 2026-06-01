// ─────────────────────────────────────────────────────────────────────────────
// IDEMPOTENT EFFECT SINK — the exactly-once boundary for side effects.
//
// This is the detector AND the enforcer for the M0 double-fire bug. It models a
// real, non-idempotent external tool (e.g. "send payment", "send email") fronted
// by a deterministic idempotency key. The UNIQUE index on idem_key is the dedup
// boundary: a re-fire after a crash/replay is silently collapsed to the original
// logical effect.
//
// STRUCTURAL CONTRACT: fireEffect REQUIRES an IdempotencyKey (branded type). A
// caller cannot fire a side effect without first deriving the key from a step's
// identity via the journal/idempotency layer. There is no string-keyed escape
// hatch. This is the "make it structural, not optional" requirement from M0.
// ─────────────────────────────────────────────────────────────────────────────

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";
import type { IdempotencyKey } from "./idempotency.js";

function open(): DatabaseSync {
  mkdirSync(dirname(config.effectDbPath), { recursive: true });
  const d = new DatabaseSync(config.effectDbPath);
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
    -- The exactly-once boundary. A second physical firing of the same logical
    -- step (same deterministic idem_key) is ignored, not duplicated.
    CREATE UNIQUE INDEX IF NOT EXISTS effect_idem ON effect_log (idem_key);
  `);
  return d;
}

export interface FireResult {
  readonly id: number;
  readonly firedAt: string;
  /** true if this physical call was a deduped re-fire (the effect already existed). */
  readonly deduped: boolean;
}

/**
 * Fire a side effect exactly once per logical step.
 *
 * @param idemKey deterministic key derived from the step identity (runId:stepName).
 *   Required by type — there is no overload that accepts a raw string.
 *
 * INSERT OR IGNORE against the UNIQUE idem_key: the first call inserts and
 * "fires"; any later physical re-fire (crash recovery, concurrent racer) is a
 * no-op dedup that returns the original row id with `deduped = true`.
 */
export function fireEffect(args: {
  runId: string;
  trajectory: string;
  stepName: string;
  idemKey: IdempotencyKey;
  payload: unknown;
}): FireResult {
  const d = open();
  try {
    const firedAt = new Date().toISOString();
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
        args.idemKey,
        JSON.stringify(args.payload),
        firedAt,
        process.pid,
      );
    const deduped = info.changes === 0;
    const row = d
      .prepare(`SELECT id FROM effect_log WHERE idem_key = ?`)
      .get(args.idemKey) as { id: number };
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
  idem_key: string;
  payload: string;
  fired_at: string;
  pid: number;
}

export function effectsFor(runId: string): EffectRow[] {
  const d = open();
  try {
    return d
      .prepare(`SELECT * FROM effect_log WHERE run_id = ? ORDER BY id`)
      .all(runId) as unknown as EffectRow[];
  } finally {
    d.close();
  }
}

/** Count physical effect rows recorded for a (runId, stepName). */
export function countEffects(runId: string, stepName: string): number {
  const d = open();
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

/** Test/harness utility: wipe the effect log. Never call in production paths. */
export function resetEffects(): void {
  const d = open();
  try {
    d.exec(`DELETE FROM effect_log`);
  } finally {
    d.close();
  }
}
