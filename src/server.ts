
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
import { config } from "./config.js";
import { allowHitlInputSubmit } from "./hitl-input-rate-limit.js";
import { enforceMutatingApiAuth } from "./api-auth.js";
import {
  handleRunsWebSocketUpgrade,
  wsRunsEnabled,
  WS_RUNS_PATH,
} from "./ws-runs.js";
import { logHttpRequest, logServerError, logServerStart } from "./logging.js";
import { applyCors, applySecurityHeaders } from "./http-security.js";
import {
  exportJsonlFromSource,
  exportBundleJsonlFromSource,
} from "./export-source.js";

const MAX_IMPORT_BYTES = 32 * 1024 * 1024;

export const HITL_SUBMIT_OFFLINE_ERROR =
  "HITL submit requires live mode (SQLite journal + Restate ingress). " +
  "Offline export can list paused runs but cannot resolve the durable promise.";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIRS = [
  join(__dirname, "..", "web"),
  join(__dirname, "..", "..", "web"),
];

function webFile(rel: string): string | null {
  for (const base of WEB_DIRS) {
    const p = normalize(join(base, rel));
    if (!p.startsWith(normalize(base))) return null;
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
  readonly importPath?: string;
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

async function restateReady(): Promise<boolean> {
  try {
    const res = await fetch(`${config.restateAdmin}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function handleOps(
  ctx: Route,
  url: URL,
  res: ServerResponse,
): boolean | Promise<boolean> {
  const p = url.pathname;
  if (p === "/health") {
    sendJson(res, 200, { ok: true, live: ctx.live, label: ctx.label });
    return true;
  }
  if (p === "/ready") {
    if (!ctx.live) {
      sendJson(res, 200, { ready: true, mode: "offline-import" });
      return true;
    }
    return restateReady().then((ready) => {
      sendJson(res, ready ? 200 : 503, {
        ready,
        restateAdmin: config.restateAdmin,
      });
      return true;
    });
  }
  if (p === "/metrics") {
    const body = [
      "# HELP durabl_ui_up Replay UI server process is up.",
      "# TYPE durabl_ui_up gauge",
      "durabl_ui_up 1",
    ].join("\n");
    sendText(res, 200, `${body}\n`, "text/plain; version=0.0.4; charset=utf-8");
    return true;
  }
  return false;
}

async function restateAdminReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${config.restateAdmin}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function prometheusMetricsStub(ctx: Route): string {
  const live = ctx.live ? "1" : "0";
  return [
    "# HELP durabl_up durabl replay UI process is up (1 = yes).",
    "# TYPE durabl_up gauge",
    "durabl_up 1",
    "# HELP durabl_live journal source is live SQLite (1) vs imported export (0).",
    "# TYPE durabl_live gauge",
    `durabl_live ${live}`,
    "",
  ].join("\n");
}

/** K8s-style liveness/readiness + Prometheus scrape stub (not under /api/*). */
async function handleOpsProbe(
  ctx: Route,
  pathname: string,
  res: ServerResponse,
): Promise<boolean> {
  if (pathname === "/health") {
    sendJson(res, 200, { ok: true });
    return true;
  }
  if (pathname === "/ready") {
    if (!ctx.live) {
      sendJson(res, 200, { ready: true });
      return true;
    }
    const ok = await restateAdminReachable();
    sendJson(res, ok ? 200 : 503, { ready: ok });
    return true;
  }
  if (pathname === "/metrics") {
    sendText(res, 200, prometheusMetricsStub(ctx), "text/plain; version=0.0.4; charset=utf-8");
    return true;
  }
  return false;
}

async function readBodyBytes(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const c of req) {
    const buf = Buffer.isBuffer(c) ? c : Buffer.from(c);
    total += buf.length;
    if (total > maxBytes) throw new Error("body too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

async function readTextBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return (await readBodyBytes(req, maxBytes)).toString("utf8");
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const raw = (await readBodyBytes(req, MAX_IMPORT_BYTES)).toString("utf8").trim();
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
      exportPath: ctx.exportPath,
      uiUrl: requestUiUrl(req, ctx.host, ctx.port),
      wsEnabled,
      wsPath: wsEnabled ? WS_RUNS_PATH : null,
      ...(ctx.live ? {} : { hitlSubmitDisabledReason: HITL_SUBMIT_OFFLINE_ERROR }),
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
  if (p === "/api/export" && req.method === "GET") {
    const runId = url.searchParams.get("runId");
    if (!runId) return badReq(res, "runId required");
    const bundle = url.searchParams.get("bundle") !== "false";
    try {
      const jsonl = bundle
        ? exportBundleJsonlFromSource(source, runId)
        : exportJsonlFromSource(source, runId);
      const safe = runId.replace(/[^\w.-]+/g, "_");
      const filename = bundle ? `${safe}-bundle.jsonl` : `${safe}.jsonl`;
      res.writeHead(200, {
        "content-type": "application/x-ndjson; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      });
      res.end(jsonl);
    } catch (e) {
      return badReq(res, e instanceof Error ? e.message : String(e));
    }
    return true;
  }
  if (p === "/api/import" && req.method === "POST") {
    return handleImport(ctx, req, res);
  }
  return false;
}

async function handleImport(
  ctx: Route,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  let jsonl: string;
  try {
    jsonl = (await readTextBody(req, MAX_IMPORT_BYTES)).trim();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "body too large") {
      sendJson(res, 413, { error: "import too large (max 32 MiB)" });
      return true;
    }
    return badReq(res, msg);
  }
  if (!jsonl) return badReq(res, "empty JSONL body");
  try {
    const origin = `imported:upload:${Date.now()}`;
    ctx.source = importJournalSource(jsonl, origin);
    ctx.label = "browser upload (OFFLINE — no substrate)";
    ctx.live = false;
    ctx.exportPath = null;
    sendJson(res, 200, {
      ok: true,
      origin: ctx.source.origin,
      label: ctx.label,
      live: false,
      hitlSubmitEnabled: false,
      hitlSubmitDisabledReason: HITL_SUBMIT_OFFLINE_ERROR,
      runs: ctx.source.allRunIds().length,
    });
  } catch (e) {
    return badReq(res, e instanceof Error ? e.message : String(e));
  }
  return true;
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

  if (!allowHitlInputSubmit(runId)) {
    sendJson(res, 429, { error: "too many requests" });
    return true;
  }

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

export interface ServerHandle {
  readonly url: string;
  close(): Promise<void>;
}

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
        applySecurityHeaders(res);
        if (!applyCors(req, res)) return;
        if (await handleOpsProbe(ctx, url.pathname, res)) return;
        if (url.pathname.startsWith("/api/")) {
          if (!enforceMutatingApiAuth(req, res, url.pathname, sendJson)) return;
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

export async function startServer(opts: ServerOptions = {}): Promise<string> {
  const h = await startServerHandle(opts);
  return h.url;
}
