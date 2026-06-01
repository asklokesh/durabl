// Harness support: drive the local restate-server (single self-hostable binary)
// and the SDK service process. Used only by the gate harness, not by production.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Socket } from "node:net";
import { config } from "../config.js";
import type { DeployTarget } from "../deploy-target.js";

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

// ─── M4 deploy-target-aware control (config-only target switching) ────────────

/** Is a Docker daemon reachable? Honest gate: we never fake a docker run. */
export function dockerAvailable(): boolean {
  const r = spawnSync("docker", ["info"], { encoding: "utf8", timeout: 15000 });
  return r.status === 0;
}

/**
 * Can the docker target actually RUN here? Requires (a) a reachable daemon AND
 * (b) the restate image already present LOCALLY (we never trigger a network
 * pull in the gate — that can hang in air-gapped/credential-broken CI). If the
 * image is absent we honestly report CONFIG-READY-NOT-RUN instead of hanging.
 */
export function dockerImagePresent(image: string): boolean {
  const r = spawnSync("docker", ["image", "inspect", image], {
    encoding: "utf8",
    timeout: 15000,
  });
  return r.status === 0;
}

export function dockerTargetRunnable(image: string): {
  runnable: boolean;
  reason: string;
} {
  if (!dockerAvailable())
    return { runnable: false, reason: "no Docker daemon reachable" };
  if (!dockerImagePresent(image))
    return {
      runnable: false,
      reason: `image ${image} not present locally (gate does not pull over the network)`,
    };
  return { runnable: true, reason: "daemon up and image present" };
}

/**
 * Start the local restate-server bound to a target's ports/data dir. The
 * default ingress/admin (8080/9070) are the server defaults; a target that
 * overrides them must also configure restate-server accordingly. For M4 the
 * `local` target uses the defaults.
 */
export function startRestateServerForTarget(target: DeployTarget): ChildProcess {
  mkdirSync(target.dataDir, { recursive: true });
  return spawn(RESTATE_SERVER_BIN, [], {
    env: {
      ...process.env,
      RESTATE_BASE_DIR: target.dataDir,
      RESTATE_LOG_FILTER: process.env.RESTATE_LOG_FILTER ?? "warn",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
}

/**
 * Start a CONTAINERIZED restate for the `docker` target. Maps the container's
 * ingress(8080)/admin(9070) to the target's distinct host ports, and tells the
 * container to reach the host-run SDK service via host.docker.internal. Returns
 * the `docker run` child (foreground); stop with stopDockerRestate().
 */
export function startDockerRestate(target: DeployTarget): ChildProcess {
  const ingressPort = new URL(target.ingress).port || "8081";
  const adminPort = new URL(target.admin).port || "9071";
  mkdirSync(target.dataDir, { recursive: true });
  // Clean any prior container with the same name (idempotent harness).
  spawnSync("docker", ["rm", "-f", target.dockerContainer!], { encoding: "utf8" });
  return spawn(
    "docker",
    [
      "run",
      "--rm",
      "--pull=never",
      "--name",
      target.dockerContainer!,
      "--add-host",
      "host.docker.internal:host-gateway",
      "-p",
      `${ingressPort}:8080`,
      "-p",
      `${adminPort}:9070`,
      target.dockerImage!,
    ],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
}

export function stopDockerRestate(target: DeployTarget): void {
  spawnSync("docker", ["rm", "-f", target.dockerContainer!], { encoding: "utf8" });
}

/** Wait for a target's admin health endpoint. */
export function waitForRestateAt(adminUrl: string, timeoutMs = 90000): Promise<boolean> {
  return waitForHttp(`${adminUrl}/health`, timeoutMs);
}

/**
 * Start the SDK service for a specific target: the service binds the target's
 * servicePort and the workflow uses the target's ingress. The crash env can be
 * merged in for the durability-under-provider-switch sub-gate.
 */
export function startServiceForTarget(
  target: DeployTarget,
  env: Record<string, string>,
): ServiceHandle {
  const proc = spawn("node", ["--enable-source-maps", "dist/service.js"], {
    env: {
      ...process.env,
      ...env,
      DURABL_SERVE: "1",
      DURABL_SERVICE_PORT: String(target.servicePort),
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  return { proc, pid: proc.pid! };
}

/** TCP readiness for an arbitrary port (target-aware). */
export async function waitForPort(port: number, timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await tcpOpen(port, 1000)) return true;
    await sleep(200);
  }
  return false;
}

/**
 * Register the SDK deployment with a target's admin endpoint. For the docker
 * target, the container reaches the host service via host.docker.internal.
 */
export function registerDeploymentAt(
  adminUrl: string,
  serviceUrl: string,
): { ok: boolean; out: string } {
  // The restate CLI takes the admin endpoint from RESTATE_ADMIN_URL (env), not
  // a flag — point it at the target's admin (e.g. the containerized restate).
  const r = spawnSync(
    RESTATE_CLI_BIN,
    ["-y", "deployments", "register", serviceUrl, "--force"],
    { encoding: "utf8", env: { ...process.env, RESTATE_ADMIN_URL: adminUrl } },
  );
  return { ok: r.status === 0, out: (r.stdout ?? "") + (r.stderr ?? "") };
}
