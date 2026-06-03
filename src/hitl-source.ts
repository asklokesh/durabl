// HITL helpers for journal sources + substrate resume (M5 web UI).
// Paused state is derived from the journal (portable, works offline).
// Resume writes go through Restate ingress (live mode only).

import { config } from "./config.js";
import { ingressFetch } from "./restate-ingress.js";
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

function parseProvideInputResponse(
  runId: string,
  text: string,
): { runId: string; accepted: boolean } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { runId, accepted: true };
  }
  const parsed = JSON.parse(trimmed) as { runId?: unknown; accepted?: unknown };
  return {
    runId: typeof parsed.runId === "string" ? parsed.runId : runId,
    accepted: parsed.accepted !== false,
  };
}

function isTransientIngressError(msg: string): boolean {
  return /RT0010|reading the response body|ECONNRESET|fetch failed|terminated|aborted/i.test(msg);
}

/** Resolve human input via Restate (same path as `durabl hitl-input`). */
export async function provideInputViaIngress(
  runId: string,
  decision: string,
  ingress = config.restateIngress,
): Promise<{ runId: string; accepted: boolean }> {
  const url = `${ingress}/HitlAgentRun/${runId}/provideInput`;
  const init: RequestInit = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision } satisfies HitlInput),
  };

  let last: unknown;
  for (const delayMs of [0, 75, 200]) {
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
    try {
      const res = await ingressFetch(url, init);
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`provideInput ${runId} -> ${res.status}: ${text}`);
      }
      return parseProvideInputResponse(runId, text);
    } catch (e) {
      last = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (!isTransientIngressError(msg)) break;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}
