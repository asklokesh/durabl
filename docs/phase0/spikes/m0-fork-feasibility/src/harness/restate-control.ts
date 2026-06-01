// THROWAWAY SPIKE CODE — not production.
// Helpers to drive the local restate-server (single self-hostable binary) and
// the SDK service process for the gate harness.

import { spawn, spawnSync, ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Socket } from "node:net";

// Resolve project-local restate binaries (installed as devDependencies) so the
// harness starts the engine offline and fast — no npx network round-trips.
const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN_DIR = resolve(__dirname, "../../node_modules/.bin");
const RESTATE_SERVER_BIN = resolve(BIN_DIR, "restate-server");
const RESTATE_CLI_BIN = resolve(BIN_DIR, "restate");

export const RESTATE_INGRESS = "http://localhost:8080";
export const RESTATE_ADMIN = "http://localhost:9070";
export const SERVICE_PORT = 9080;
export const SERVICE_URL = `http://localhost:${SERVICE_PORT}`;
export const RESTATE_DATA_DIR =
  process.env.RESTATE_DATA_DIR ?? "/tmp/durabl-m0-spike/restate-data";

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHttp(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  return false;
}

export function startRestateServer(): ChildProcess {
  mkdirSync(RESTATE_DATA_DIR, { recursive: true });
  const proc = spawn(RESTATE_SERVER_BIN, [], {
    env: {
      ...process.env,
      RESTATE_BASE_DIR: RESTATE_DATA_DIR,
      // Quiet-ish logs; keep warnings/errors.
      RESTATE_LOG_FILTER: process.env.RESTATE_LOG_FILTER ?? "warn",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  return proc;
}

export async function waitForRestate(timeoutMs = 60000): Promise<boolean> {
  // Admin health endpoint
  return waitForHttp(`${RESTATE_ADMIN}/health`, timeoutMs);
}

export interface ServiceHandle {
  proc: ChildProcess;
  pid: number;
}

// Start the SDK service process with a given crash configuration.
export function startService(env: Record<string, string>): ServiceHandle {
  const proc = spawn("node", ["--enable-source-maps", "dist/service.js"], {
    env: { ...process.env, ...env, SERVICE_PORT: String(SERVICE_PORT) },
    stdio: ["ignore", "inherit", "inherit"],
  });
  return { proc, pid: proc.pid! };
}

function tcpOpen(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolveP) => {
    const s = new Socket();
    const done = (ok: boolean) => {
      s.destroy();
      resolveP(ok);
    };
    s.setTimeout(timeoutMs);
    s.once("connect", () => done(true));
    s.once("timeout", () => done(false));
    s.once("error", () => done(false));
    s.connect(port, "127.0.0.1");
  });
}

export async function waitForService(timeoutMs = 20000): Promise<boolean> {
  // The SDK readiness signal: the HTTP port is accepting TCP connections.
  // (The SDK /discover endpoint speaks a content-negotiated protocol that does
  // not answer a plain probe cleanly, so we use a raw TCP connect check; the
  // subsequent restate deployments register confirms real readiness.)
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await tcpOpen(SERVICE_PORT, 1000)) return true;
    await sleep(200);
  }
  return false;
}

// Register the running SDK deployment with restate-server (idempotent: --force).
export function registerDeployment(): { ok: boolean; out: string } {
  const r = spawnSync(
    RESTATE_CLI_BIN,
    ["-y", "deployments", "register", SERVICE_URL, "--force"],
    { encoding: "utf8" },
  );
  return {
    ok: r.status === 0,
    out: (r.stdout ?? "") + (r.stderr ?? ""),
  };
}

export function killProc(proc: ChildProcess): void {
  try {
    if (proc.pid) process.kill(proc.pid, "SIGKILL");
  } catch {
    /* already dead */
  }
}
