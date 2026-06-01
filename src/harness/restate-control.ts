// Harness support: drive the local restate-server (single self-hostable binary)
// and the SDK service process. Used only by the gate harness, not by production.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Socket } from "node:net";
import { config } from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Project-local restate binaries (devDependencies) — offline, no npx round-trip.
const BIN_DIR = resolve(__dirname, "../../node_modules/.bin");
const RESTATE_SERVER_BIN = resolve(BIN_DIR, "restate-server");
const RESTATE_CLI_BIN = resolve(BIN_DIR, "restate");

export const SERVICE_URL = `http://localhost:${config.servicePort}`;

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
  mkdirSync(config.restateDataDir, { recursive: true });
  return spawn(RESTATE_SERVER_BIN, [], {
    env: {
      ...process.env,
      RESTATE_BASE_DIR: config.restateDataDir,
      RESTATE_LOG_FILTER: process.env.RESTATE_LOG_FILTER ?? "warn",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
}

export function waitForRestate(timeoutMs = 60000): Promise<boolean> {
  return waitForHttp(`${config.restateAdmin}/health`, timeoutMs);
}

export interface ServiceHandle {
  proc: ChildProcess;
  pid: number;
}

/** Start the SDK service with a given crash configuration. */
export function startService(env: Record<string, string>): ServiceHandle {
  const proc = spawn("node", ["--enable-source-maps", "dist/service.js"], {
    env: {
      ...process.env,
      ...env,
      DURABL_SERVE: "1",
      DURABL_SERVICE_PORT: String(config.servicePort),
    },
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

// SDK readiness = HTTP port accepting TCP. The SDK /discover endpoint uses a
// content-negotiated protocol that does not answer a plain probe cleanly; the
// subsequent `deployments register` confirms real readiness.
export async function waitForService(timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await tcpOpen(config.servicePort, 1000)) return true;
    await sleep(200);
  }
  return false;
}

export function registerDeployment(): { ok: boolean; out: string } {
  const r = spawnSync(
    RESTATE_CLI_BIN,
    ["-y", "deployments", "register", SERVICE_URL, "--force"],
    { encoding: "utf8" },
  );
  return { ok: r.status === 0, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

export function killProc(proc: ChildProcess): void {
  try {
    if (proc.pid) process.kill(proc.pid, "SIGKILL");
  } catch {
    /* already dead */
  }
}
