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
//   - Read-only: every endpoint is a pure journal read; nothing mutates state or
//     invokes the substrate. Serving an imported export runs with NO substrate.
//   - No secrets read or logged; config via env vars only.
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
  rootRuns,
} from "./inspect-source.js";

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

function buildSource(opts: ServerOptions): { source: JournalSource; label: string } {
  if (opts.source) return { source: opts.source, label: opts.source.origin };
  if (opts.importPath) {
    const jsonl = readFileSync(opts.importPath, "utf8");
    return {
      source: importJournalSource(jsonl, `imported:${opts.importPath}`),
      label: `imported export ${opts.importPath} (OFFLINE — no substrate)`,
    };
  }
  return { source: liveJournalSource(), label: "live SQLite journal" };
}

interface Route {
  source: JournalSource;
  label: string;
}

function handleApi(
  ctx: Route,
  url: URL,
  res: ServerResponse,
): boolean {
  const p = url.pathname;
  const { source } = ctx;

  if (p === "/api/health") {
    sendJson(res, 200, { ok: true, origin: source.origin, source: source.origin, label: ctx.label });
    return true;
  }
  if (p === "/api/runs") {
    const ids = source.allRunIds();
    const runs = ids.map((id) => {
      const m = source.runMeta(id);
      const steps = source.trajectory(id);
      return {
        runId: id,
        trajectory: m?.trajectory ?? "main",
        parentRun: m?.parentRun ?? null,
        forkedAtSeq: m?.forkedAtSeq ?? null,
        steps: steps.length,
        createdAt: m?.createdAt ?? "",
      };
    });
    sendJson(res, 200, { source: source.origin, label: ctx.label, roots: rootRuns(source), runs });
    return true;
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
  return false;
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
  const { source, label } = buildSource(opts);
  const ctx: Route = { source, label };
  const host = process.env.DURABL_UI_HOST ?? "127.0.0.1";
  const port = opts.port ?? Number(process.env.DURABL_UI_PORT ?? 7878);

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? "/", `http://${host}:${port}`);
      if (url.pathname.startsWith("/api/")) {
        if (!handleApi(ctx, url, res)) sendJson(res, 404, { error: "not found" });
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
      sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      resolve({
        url: `http://${host}:${port}`,
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
