// In-memory journal overlay: queued offline HITL decisions appear as hitl_input steps.

import { deriveIdempotencyKey } from "./idempotency.js";
import type { JournalSource } from "./journal-source.js";
import { listQueuedHitl } from "./hitl-offline-queue.js";
import { JOURNAL_SCHEMA_VERSION, type JournalEntry } from "./step-model.js";

const HITL_INPUT_STEP = "hitl-input";

function overlayTrajectory(
  base: readonly JournalEntry[],
  queued: { decision: string; createdAt: string } | undefined,
): JournalEntry[] {
  if (!queued) return [...base];
  if (base.some((s) => s.kind === "hitl_input")) return [...base];
  const hasPause = base.some((s) => s.kind === "hitl_pause");
  if (!hasPause || base.length === 0) return [...base];

  const runId = base[0]!.runId;
  const pauseSeq = base.find((s) => s.kind === "hitl_pause")!.seq;
  const inputSeq = pauseSeq + 1;
  const synthetic: JournalEntry = {
    schema: JOURNAL_SCHEMA_VERSION,
    runId,
    seq: inputSeq,
    stepName: HITL_INPUT_STEP,
    kind: "hitl_input",
    idemKey: deriveIdempotencyKey(runId, HITL_INPUT_STEP),
    output: queued.decision,
    sideEffect: false,
    seededFrom: null,
    recordedAt: queued.createdAt,
  };
  return [...base, synthetic].sort((a, b) => a.seq - b.seq);
}

/** Wrap a journal source so queued offline decisions show as resumed in replay/UI. */
function queuedForRun(
  exportKey: string,
  runId: string,
): { decision: string; createdAt: string } | undefined {
  const row = listQueuedHitl(exportKey).find((r) => r.runId === runId);
  if (!row) return undefined;
  return { decision: row.decision, createdAt: row.createdAt };
}

export function overlayOfflineHitlQueue(
  base: JournalSource,
  exportKey: string,
): JournalSource {
  return {
    origin: base.origin,
    trajectory(runId: string): JournalEntry[] {
      return overlayTrajectory(base.trajectory(runId), queuedForRun(exportKey, runId));
    },
    runMeta(runId: string) {
      return base.runMeta(runId);
    },
    childRuns(parentRunId: string) {
      return base.childRuns(parentRunId);
    },
    effectsFor(runId: string) {
      return base.effectsFor(runId);
    },
    allRunIds() {
      return base.allRunIds();
    },
  };
}
