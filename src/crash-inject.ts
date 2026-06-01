// ─────────────────────────────────────────────────────────────────────────────
// CRASH INJECTION — test affordance ONLY (used by the adversarial gate harness).
//
// This is compiled into the service so the harness can request a REAL SIGKILL at
// a named step boundary. It is a NO-OP unless DURABL_CRASH_AT is set, so it has
// zero effect on a normal production run. It performs an uncatchable OS kill
// (process.kill(pid, 'SIGKILL')) — never a catchable throw — so recovery is
// driven entirely by the substrate's journal + automatic retry.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const CRASH_AT = process.env.DURABL_CRASH_AT ?? "";
const CRASH_ONCE = process.env.DURABL_CRASH_ONCE === "1";
const MARKER_DIR =
  process.env.DURABL_CRASH_MARKER_DIR ?? join(tmpdir(), "durabl-m1", "markers");

function alreadyCrashed(runId: string, point: string): boolean {
  const f = join(MARKER_DIR, `${runId}__${point.replace(/[^a-z0-9]/gi, "_")}`);
  if (existsSync(f)) return true;
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, new Date().toISOString());
  return false;
}

/** SIGKILL self at `point` iff configured. No-op when DURABL_CRASH_AT is unset. */
export function maybeCrash(runId: string, point: string): void {
  if (CRASH_AT !== point) return;
  if (CRASH_ONCE && alreadyCrashed(runId, point)) return;
  console.error(
    `[CRASH] SIGKILL self at point=${point} run=${runId} pid=${process.pid}`,
  );
  process.kill(process.pid, "SIGKILL");
  // Unreachable; guard against any signal-delivery delay doing more work.
  while (true) {
    /* spin */
  }
}
