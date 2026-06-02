// HITL helpers for journal sources + substrate resume (M5 web UI).
// Paused state is derived from the journal (portable, works offline).
// Resume writes go through Restate ingress (live mode only).

import { config } from "./config.js";
import type { JournalSource } from "./journal-source.js";
import type { HitlState } from "./journal.js";
import type { HitlInput } from "./step-model.js";

export type { HitlState };

/** Journal-derived HITL state for any {@link JournalSource}. */
export function hitlStateFromSource(source: JournalSource, runId: string): HitlState {
  const steps = source.trajectory(runId);
  const hasPause = steps.some((s) => s.kind === "hitl_pause");
  const hasInput = steps.some((s) => s.kind === "hitl_input");
  if (!hasPause) return "none";
  return hasInput ? "resumed" : "paused";
}

/** All runs paused awaiting human input in this source. */
export function pausedRunsFromSource(source: JournalSource): string[] {
  return source.allRunIds().filter((r) => hitlStateFromSource(source, r) === "paused");
}

export function isLiveJournalSource(source: JournalSource): boolean {
  return source.origin === "live-sqlite-journal";
}

/** Resolve human input via Restate (same path as `durabl hitl-input`). */
export async function provideInputViaIngress(
  runId: string,
  decision: string,
  ingress = config.restateIngress,
): Promise<{ runId: string; accepted: boolean }> {
  const res = await fetch(`${ingress}/HitlAgentRun/${runId}/provideInput`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision } satisfies HitlInput),
  });
  if (!res.ok) {
    throw new Error(`provideInput ${runId} -> ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<{ runId: string; accepted: boolean }>;
}
