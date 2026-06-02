// ─────────────────────────────────────────────────────────────────────────────
// LOCAL REPLAY WEB SERVER (M3) — self-hostable, neutral, zero external deps.
//
// A lightweight node:http server (no framework) that serves:
//   - the read-only replay APIs over a JournalSource (live OR imported export)
//   - the static single-page frontend (web/index.html etc.)
//
// SECURITY / NEUTRALITY:
//   - Binds 127.0.0.1 by default (localhost only). Override with DURABL_UI_HOST,
//     but the default never exposes the journal off the machine.
//   - No cloud, no external service, no telemetry. Runs fully locally over the
//     journal/export.
//   - Replay endpoints are read-only journal reads. M5 HITL resume endpoints
//     (`POST /api/hitl/input`) proxy to Restate ingress in LIVE mode only;
//     offline import mode surfaces paused runs from the export but cannot submit.
//   - Optional WebSocket `/api/ws/runs` (live only, DURABL_ENABLE_WS=1) streams
//     new step + HITL state events — see docs/BACKEND.md.
//   - No secrets read or logged; config via env vars only.
//   - Optional DURABL_API_KEY: when set, mutating /api/* (POST/PUT/PATCH/DELETE) require
//     Authorization: Bearer or x-api-key; unset env leaves mutating routes open (local dev).
//
// The whole point: the SAME UI renders a live run and a run imported from a
// portable JSONL export with nothing else running (the portability wedge).
// ─────────────────────────────────────────────────────────────────────────────

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";
import {
  liveJournalSource,
  importJournalSource,
  type JournalSource,
} from "./journal-source.js";
import { reconstruct, stateAt } from "./replay.js";
import {
  forkTreeFrom,
  lineageFrom,
  diffTrajectoriesFrom,
  inspectRunFrom,
  listForksFrom,
} from "./inspect-source.js";
import { listRunsForApi, parseRunsListQuery } from "./runs-list.js";
import {
  executeForkPost,
  forkApiErrorStatus,
  parseForkPostBody,
} from "./api-fork.js";
import {
  hitlStateFromSource,
  pausedRunsFromSource,
  isLiveJournalSource,
  provideInputViaIngress,
} from "./hitl-source.js";
import { logHttpRequest, logServerError, logServerStart } from "./logging.js";

import { enforceMutatingApiAuth } from "./api-auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Static assets live in <repo>/web (copied into dist via package build step, or
// served from source during dev). Resolve both.
const WEB_DIRS = [
  join(__dirname, "..", "web"), // when running from dist/server.js
  join(__dirname, "..", "..", "web"), // fallback
];

function webFile(rel: string): string | null {
  for (const base of WEB_DIRS) {
    const p = normalize(join(base, rel));
    if (!p.startsWith(normalize(base))) return null; // path-traversal guard
    if (existsSync(p)) return p;
  }
  return null;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  const s = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(s),
    "cache-control": "no-store",
  });
  res.end(s);
}

function sendText(res: ServerResponse, code: number, body: string, mime: string): void {
  res.writeHead(code, {
    "content-type": mime,
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

export interface ServerOptions {
  readonly port?: number;
  /** If set, serve a journal IMPORTED from this JSONL export file (offline). */
  readonly importPath?: string;
  /** Provide a pre-built source directly (used by the gate harness). */
  readonly source?: JournalSource;
}

function exportPathFromOrigin(origin: string): string | null {
  if (!origin.startsWith("imported:")) return null;
  const p = origin.slice("imported:".length);
  return p || null;
}

function requestUiUrl(req: IncomingMessage, host: string, port: number): string {
  const h = req.headers.host ?? `${host}:${port}`;
  const proto =
    (typeof req.headers["x-forwarded-proto"] === "string"
      ? req.headers["x-forwarded-proto"].split(",")[0]?.trim()
      : undefined) || "http";
  return `${proto}://${h}`;
}

function buildSource(opts: ServerOptions): {
  source: JournalSource;
  label: string;
  exportPath: string | null;
} {
  if (opts.source) {
    return {
      source: opts.source,
      label: opts.source.origin,
      exportPath: exportPathFromOrigin(opts.source.origin),
    };
  }
  if (opts.importPath) {
    const jsonl = readFileSync(opts.importPath, "utf8");
    return {
      source: importJournalSource(jsonl, `imported:${opts.importPath}`),
      label: `imported export ${opts.importPath} (OFFLINE — no substrate)`,
      exportPath: opts.importPath,
    };
  }
  return { source: liveJournalSource(), label: "live SQLite journal", exportPath: null };
}

interface Route {
  source: JournalSource;
  label: string;
  live: boolean;
  exportPath: string | null;
  host: string;
  port: number;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("invalid JSON body");
  }
}

function handleApi(
  ctx: Route,
  url: URL,
  res: ServerResponse,
  req: IncomingMessage,
): boolean | Promise<boolean> {
  const p = url.pathname;
  const { source } = ctx;

  if (p === "/api/health") {
    const wsEnabled = wsRunsEnabled() && ctx.live;
    sendJson(res, 200, {
      ok: true,
      origin: source.origin,
      source: source.origin,
      label: ctx.label,
      live: ctx.live,
      hitlSubmitEnabled: ctx.live,

      wsEnabled,
      wsPath: wsEnabled ? WS_RUNS_PATH : null,
    });
    return true;
  }
  if (p === "/api/runs") {
    const parsed = parseRunsListQuery(
      url.searchParams.get("limit"),
      url.searchParams.get("cursor"),
    );
    if ("error" in parsed) return badReq(res, parsed.error);
    try {
      const body = listRunsForApi(source, parsed);
      sendJson(res, 200, { source: source.origin, label: ctx.label, ...body });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "invalid cursor" || msg === "cursor not found") {
        return badReq(res, msg);
      }
      throw e;
    }
    return true;
  }
  if (p === "/api/hitl/paused") {
    const paused = pausedRunsFromSource(source).map((runId) => {
      const steps = source.trajectory(runId);
      const pauseStep = steps.find((s) => s.kind === "hitl_pause");
      return {
        runId,
        hitlState: "paused" as const,
        pauseOutput: pauseStep?.output ?? null,
        steps: steps.length,
      };
    });
    sendJson(res, 200, {
      source: source.origin,
      live: ctx.live,
      submitEnabled: ctx.live,
      paused,
    });
    return true;
  }
  if (p === "/api/hitl/status") {
    const runId = url.searchParams.get("runId");
    if (!runId) return badReq(res, "runId required");
    const state = hitlStateFromSource(source, runId);
    sendJson(res, 200, {
      runId,
      state,
      live: ctx.live,
      submitEnabled: ctx.live && state === "paused",
    });
    return true;
  }
  if (p === "/api/hitl/input" && req.method === "POST") {
    return handleHitlInput(ctx, req, res);
  }
  if (p === "/api/replay") {
    const runId = url.searchParams.get("runId");
    if (!runId) return badReq(res, "runId required");
    try {
      sendJson(res, 200, reconstruct(source, runId));
    } catch (e) {
      return badReq(res, e instanceof Error ? e.message : String(e));
    }
    return true;
  }
  if (p === "/api/state-at") {
    const runId = url.searchParams.get("runId");
    const n = Number(url.searchParams.get("n"));
    if (!runId) return badReq(res, "runId required");
    try {
      sendJson(res, 200, stateAt(source, runId, n));
    } catch (e) {
      return badReq(res, e instanceof Error ? e.message : String(e));
    }
    return true;
  }
  if (p === "/api/tree") {
    const runId = url.searchParams.get("runId");
    if (!runId) return badReq(res, "runId required");
    sendJson(res, 200, {
      tree: forkTreeFrom(source, runId),
      lineage: lineageFrom(source, runId),
    });
    return true;
  }
  if (p === "/api/diff") {
    const a = url.searchParams.get("a");
    const b = url.searchParams.get("b");
    if (!a || !b) return badReq(res, "a and b required");
    sendJson(res, 200, diffTrajectoriesFrom(source, a, b));
    return true;
  }
  if (p === "/api/inspect") {
    const runId = url.searchParams.get("runId");
    if (!runId) return badReq(res, "runId required");
    sendJson(res, 200, { source: source.origin, inspection: inspectRunFrom(source, runId) });
    return true;
  }
  if (p === "/api/lineage") {
    const runId = url.searchParams.get("runId");
    if (!runId) return badReq(res, "runId required");
    sendJson(res, 200, { source: source.origin, runId, lineage: lineageFrom(source, runId) });
    return true;
  }
  if (p === "/api/forks") {
    const runId = url.searchParams.get("runId");
    if (!runId) return badReq(res, "runId required");
    sendJson(res, 200, { source: source.origin, runId, forks: listForksFrom(source, runId) });
    return true;
  }
  if (p === "/api/fork" && req.method === "POST") {
    return handleForkPost(ctx, req, res);
  }
  return false;
}

async function handleForkPost(
  ctx: Route,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  let raw: unknown;
  try {
    raw = await readJsonBody(req);
  } catch (e) {
    return badReq(res, e instanceof Error ? e.message : String(e));
  }
  try {
    const body = parseForkPostBody(raw);
    const out = await executeForkPost(body, { live: ctx.live });
    sendJson(res, 200, out);
  } catch (e) {
    sendJson(res, forkApiErrorStatus(e), {
      error: e instanceof Error ? e.message : String(e),
      live: ctx.live,
      forkSubmitEnabled: ctx.live,
    });
  }
  return true;
}

async function handleHitlInput(
  ctx: Route,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (!ctx.live) {
    sendJson(res, 503, {
      error:
        "HITL submit requires live mode (SQLite journal + Restate ingress). " +
        "Offline export can list paused runs but cannot resolve the durable promise.",
      submitEnabled: false,
    });
    return true;
  }
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    return badReq(res, e instanceof Error ? e.message : String(e));
  }
  const o = body as Record<string, unknown>;
  const runId = typeof o.runId === "string" ? o.runId : "";
  const decision = typeof o.decision === "string" ? o.decision.trim() : "";
  if (!runId) return badReq(res, "runId required");
  if (!decision) return badReq(res, "decision required");

  const state = hitlStateFromSource(ctx.source, runId);
  if (state === "none") {
    sendJson(res, 404, { error: "run has no HITL pause", runId, state });
    return true;
  }
  if (state === "resumed") {
    sendJson(res, 200, {
      runId,
      accepted: false,
      state: "resumed",
      note: "human input already journaled; duplicate submit is a no-op",
    });
    return true;
  }

  try {
    const result = await provideInputViaIngress(runId, decision);
    sendJson(res, 200, {
      ...result,
      state: hitlStateFromSource(ctx.source, runId),
    });
  } catch (e) {
    sendJson(res, 502, {
      error: e instanceof Error ? e.message : String(e),
      runId,
      hint: "ensure Restate ingress is reachable (DURABL_RESTATE_INGRESS)",
    });
  }
  return true;
}

function badReq(res: ServerResponse, msg: string): boolean {
  sendJson(res, 400, { error: msg });
  return true;
}

/** A running server handle: its base URL and a close() to stop it. */
export interface ServerHandle {
  readonly url: string;
  close(): Promise<void>;
}

/**
 * Start the replay UI server. Resolves to a {@link ServerHandle} once listening.
 * Binds localhost by default (DURABL_UI_HOST to override).
 */
export function startServerHandle(opts: ServerOptions = {}): Promise<ServerHandle> {
  const { source, label, exportPath } = buildSource(opts);
  const live = isLiveJournalSource(source);
  const host = process.env.DURABL_UI_HOST ?? "127.0.0.1";
  const port = opts.port ?? Number(process.env.DURABL_UI_PORT ?? 7878);
  const ctx: Route = { source, label, live, exportPath, host, port };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const started = performance.now();
    const method = req.method ?? "GET";
    let pathname = "/";

    res.once("finish", () => {
      logHttpRequest({
        method,
        path: pathname,
        status: res.statusCode || 500,
        durationMs: Math.round(performance.now() - started),
        live: ctx.live,
      });
    });

    void (async () => {

      try {
        const url = new URL(req.url ?? "/", `http://${host}:${port}`);
        pathname = url.pathname;
        if (url.pathname.startsWith("/api/")) {
          const handled = await handleApi(ctx, url, res, req);
          if (!handled) sendJson(res, 404, { error: "not found" });
          return;
        }
        // static
        let rel = url.pathname === "/" ? "/index.html" : url.pathname;
        rel = rel.replace(/^\/+/, "");
        const file = webFile(rel) ?? webFile("index.html");
        if (!file) {
          sendText(res, 404, "not found", "text/plain");
          return;
        }
        const ext = file.slice(file.lastIndexOf("."));
        sendText(res, 200, readFileSync(file, "utf8"), MIME[ext] ?? "application/octet-stream");
      } catch (e) {
        logServerError({
          path: pathname,
          message: e instanceof Error ? e.message : String(e),
        });
        sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }
    })();
  });

  server.on("upgrade", (req, socket) => {
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    if (url.pathname === WS_RUNS_PATH) {
      handleRunsWebSocketUpgrade(ctx, url, req, socket);
      return;
    }
    socket.destroy();
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const url = `http://${host}:${port}`;
      logServerStart({ url, origin: source.origin, live });
      resolve({
        url,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res());
          }),
      });
    });
  });
}

/** Backward-compatible: start the server and resolve to the base URL string. */
export async function startServer(opts: ServerOptions = {}): Promise<string> {
  const h = await startServerHandle(opts);
  return h.url;
}
