// Optional live-mode WebSocket: step events for a single run (`/api/ws/runs`).
// Enabled only when DURABL_ENABLE_WS=1 and the journal source is live SQLite.

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { JournalEntry } from "./step-model.js";
import type { JournalSource } from "./journal-source.js";
import { hitlStateFromSource } from "./hitl-source.js";
import {
  acceptWebSocket,
  isWebSocketUpgrade,
  rejectUpgrade,
  sendWsText,
} from "./ws-frame.js";

export const WS_RUNS_PATH = "/api/ws/runs";

export function wsRunsEnabled(): boolean {
  return process.env.DURABL_ENABLE_WS === "1";
}

function pollMs(): number {
  const n = Number(process.env.DURABL_WS_POLL_MS ?? 500);
  return Number.isFinite(n) && n >= 100 ? Math.min(n, 10_000) : 500;
}

export interface WsRunsRouteContext {
  readonly source: JournalSource;
  readonly live: boolean;
}

/**
 * Handle HTTP upgrade for `/api/ws/runs?runId=…`. Live mode only; polls the journal.
 */
export function handleRunsWebSocketUpgrade(
  ctx: WsRunsRouteContext,
  url: URL,
  req: IncomingMessage,
  socket: Duplex,
): void {
  if (!wsRunsEnabled()) {
    rejectUpgrade(socket, 404, "WebSocket disabled (set DURABL_ENABLE_WS=1)");
    return;
  }
  if (!ctx.live) {
    rejectUpgrade(socket, 503, "WebSocket requires live mode (SQLite journal)");
    return;
  }
  if (!isWebSocketUpgrade(req)) {
    rejectUpgrade(socket, 400, "expected WebSocket upgrade");
    return;
  }

  const runId = url.searchParams.get("runId")?.trim() ?? "";
  if (!runId) {
    rejectUpgrade(socket, 400, "runId query parameter required");
    return;
  }

  acceptWebSocket(req, socket);

  let lastSeq = 0;
  let lastHitl = hitlStateFromSource(ctx.source, runId);
  const { source } = ctx;
  let timer: ReturnType<typeof setInterval> | undefined;

  const cleanup = (): void => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    if (!socket.destroyed) socket.destroy();
  };

  const send = (msg: unknown): void => {
    try {
      sendWsText(socket, JSON.stringify(msg));
    } catch {
      cleanup();
    }
  };

  const pushNewSteps = (): void => {
    const steps = source.trajectory(runId);
    for (const entry of steps) {
      if (entry.seq > lastSeq) {
        lastSeq = entry.seq;
        send(stepEvent(entry));
      }
    }
    const hitl = hitlStateFromSource(source, runId);
    if (hitl !== lastHitl) {
      lastHitl = hitl;
      send({ type: "hitl_state", runId, state: hitl });
    }
  };

  const initial = source.trajectory(runId);
  lastSeq = initial.length ? initial[initial.length - 1]!.seq : 0;

  send({
    type: "hello",
    runId,
    live: true,
    path: WS_RUNS_PATH,
    steps: initial.length,
    hitlState: lastHitl,
    pollMs: pollMs(),
  });

  pushNewSteps();
  timer = setInterval(pushNewSteps, pollMs());
  timer.unref?.();

  socket.on("close", cleanup);
  socket.on("error", cleanup);
}

function stepEvent(entry: JournalEntry): Record<string, unknown> {
  return {
    type: "step",
    runId: entry.runId,
    seq: entry.seq,
    stepName: entry.stepName,
    kind: entry.kind,
    sideEffect: entry.sideEffect,
    recordedAt: entry.recordedAt,
    output: entry.output,
  };
}
