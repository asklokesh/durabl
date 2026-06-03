// Offline HITL queue — SQLite at $DURABL_DATA_DIR/hitl-offline-queue.db.
// Partitioned by exportKey (hash of journal origin), not filesystem paths.

import { createHash } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { provideInputViaIngress } from "./hitl-source.js";

const RUN_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const MAX_DECISION_LEN = 8_192;

let db: DatabaseSync | null = null;

function queueDbPath(): string {
  const root = process.env.DURABL_DATA_DIR ?? join(process.env.TMPDIR ?? "/tmp", "durabl-m1");
  return join(root, "hitl-offline-queue.db");
}

function openDb(): DatabaseSync {
  if (db) return db;
  const path = queueDbPath();
  db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_hitl (
      export_key TEXT NOT NULL,
      run_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      created_at TEXT NOT NULL,
      flushed_at TEXT,
      PRIMARY KEY (export_key, run_id)
    );
  `);
  return db;
}

/** Stable partition key for an imported journal origin string. */
export function exportKeyForOrigin(origin: string): string {
  return createHash("sha256").update(origin, "utf8").digest("hex");
}

export function validateHitlRunId(runId: string): string | null {
  const t = runId.trim();
  if (!t) return "runId required";
  if (t.length > 128) return "runId too long";
  if (!RUN_ID_RE.test(t)) return "invalid runId";
  if (t.includes("..") || t.includes("/") || t.includes("\\")) return "invalid runId";
  return null;
}

export function validateHitlDecision(decision: string): string | null {
  const t = decision.trim();
  if (!t) return "decision required";
  if (t.length > MAX_DECISION_LEN) return "decision too long";
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(t)) return "invalid decision";
  return null;
}

export interface QueuedHitlRow {
  runId: string;
  decision: string;
  createdAt: string;
}

export function listQueuedHitl(exportKey: string): QueuedHitlRow[] {
  const rows = openDb()
    .prepare(
      `SELECT run_id, decision, created_at FROM pending_hitl
       WHERE export_key = ? ORDER BY created_at ASC`,
    )
    .all(exportKey) as { run_id: string; decision: string; created_at: string }[];
  return rows.map((r) => ({
    runId: r.run_id,
    decision: r.decision,
    createdAt: r.created_at,
  }));
}

export function enqueueOfflineHitl(
  exportKey: string,
  runId: string,
  decision: string,
): void {
  const errRun = validateHitlRunId(runId);
  if (errRun) throw new Error(errRun);
  const errDec = validateHitlDecision(decision);
  if (errDec) throw new Error(errDec);
  const trimmed = decision.trim();
  const createdAt = new Date().toISOString();
  openDb()
    .prepare(
      `INSERT INTO pending_hitl (export_key, run_id, decision, created_at, flushed_at)
       VALUES (?, ?, ?, ?, NULL)
       ON CONFLICT(export_key, run_id) DO UPDATE SET
         decision = excluded.decision,
         created_at = excluded.created_at,
         flushed_at = NULL`,
    )
    .run(exportKey, runId.trim(), trimmed, createdAt);
}

export async function flushOfflineHitlQueue(
  isStillPaused: (runId: string) => boolean,
): Promise<{ flushed: number; skipped: number; failed: number }> {
  const conn = openDb();
  const pending = conn
    .prepare(
      `SELECT export_key, run_id, decision FROM pending_hitl WHERE flushed_at IS NULL`,
    )
    .all() as { export_key: string; run_id: string; decision: string }[];

  let flushed = 0;
  let skipped = 0;
  let failed = 0;
  const markFlushed = conn.prepare(
    `UPDATE pending_hitl SET flushed_at = ? WHERE export_key = ? AND run_id = ?`,
  );

  for (const row of pending) {
    if (!isStillPaused(row.run_id)) {
      skipped++;
      continue;
    }
    try {
      await provideInputViaIngress(row.run_id, row.decision);
      markFlushed.run(new Date().toISOString(), row.export_key, row.run_id);
      flushed++;
    } catch {
      failed++;
    }
  }
  return { flushed, skipped, failed };
}

/** Test teardown — closes DB so the next open uses the current DURABL_DATA_DIR. */
export function closeOfflineHitlQueueForTests(): void {
  if (db) {
    db.close();
    db = null;
  }
}
