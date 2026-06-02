// Harness support: drive the local restate-server (single self-hostable binary)
// and the SDK service process. Used only by the gate harness, not by production.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { Socket } from "node:net";
import { config } from "../config.js";
import type { DeployTarget } from "../deploy-target.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Project-local restate binaries (devDependencies) — offline, no npx round-trip.
const BIN_DIR = resolve(__dirname, "../../node_modules/.bin");
const RESTATE_SERVER_BIN = resolve(BIN_DIR, "restate-server");
const RESTATE_CLI_BIN = resolve(BIN_DIR, "restate");

export const SERVICE_URL = `http://localhost:${config.servicePort}`;

const HARNESS_LOCK_FILE =
  process.env.DURABL_HARNESS_LOCK ?? join(tmpdir(), "durabl-harness.lock");

/** Extra ports used by replay / HITL UI gates (must be free between runs). */
const EXTRA_HARNESS_PORTS = [7879, 17878, 17879] as const;

function portFromUrl(url: string, fallback: number): number {
  const p = new URL(url).port;
  return p ? Number(p) : fallback;
}

/** Host ports the sequential gate suite binds (single-flight via harness lock). */
export const harnessPorts = {
  ingress: portFromUrl(config.restateIngress, 8080),
  admin: portFromUrl(config.restateAdmin, 9070),
  service: config.servicePort,
} as const;

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

export function waitForRestate(timeoutMs = 90000): Promise<boolean> {
  return waitForHttp(`${config.restateAdmin}/health`, timeoutMs);
}

/** True when admin health is down (server stopped or not yet listening). */
export async function waitForRestateDown(timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${config.restateAdmin}/health`);
      if (res.status >= 500) return true;
    } catch {
      return true;
    }
    await sleep(250);
  }
  return false;
}

function isPidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Serialize gate processes so only one harness owns 8080/9070/9080 at a time. */
export async function acquireHarnessLock(timeoutMs = 900_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      writeFileSync(HARNESS_LOCK_FILE, String(process.pid), { flag: "wx" });
      return;
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw e;
      try {
        if (existsSync(HARNESS_LOCK_FILE)) {
          const holder = Number(readFileSync(HARNESS_LOCK_FILE, "utf8").trim());
          if (!holder || !isPidAlive(holder)) unlinkSync(HARNESS_LOCK_FILE);
        }
      } catch {
        try {
          unlinkSync(HARNESS_LOCK_FILE);
        } catch {
          /* contested */
        }
      }
      await sleep(500);
    }
  }
  throw new Error(`harness lock timeout (${HARNESS_LOCK_FILE})`);
}

export function releaseHarnessLock(): void {
  try {
    if (!existsSync(HARNESS_LOCK_FILE)) return;
    const holder = Number(readFileSync(HARNESS_LOCK_FILE, "utf8").trim());
    if (holder === process.pid) unlinkSync(HARNESS_LOCK_FILE);
  } catch {
    /* best-effort */
  }
}

export async function waitForPortDown(port: number, timeoutMs = 30000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await tcpOpen(port, 500))) return true;
    await sleep(200);
  }
  return false;
}

async function waitForHarnessPortsDown(timeoutMs = 30000): Promise<boolean> {
  const ports = [
    harnessPorts.ingress,
    harnessPorts.admin,
    harnessPorts.service,
    ...EXTRA_HARNESS_PORTS,
  ];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const busy = await Promise.all(ports.map((p) => tcpOpen(p, 400)));
    if (!busy.some(Boolean)) return true;
    await sleep(250);
  }
  return false;
}

export interface HarnessTeardownOptions {
  /** Remove the M4 docker restate container if set. */
  dockerContainer?: string;
}

/**
 * Kill stale harness children and wait until ingress/admin/service (+ UI) ports
 * are free. Idempotent — safe at gate start and end.
 */
export async function harnessTeardown(opts: HarnessTeardownOptions = {}): Promise<void> {
  killStaleServiceProcesses();
  spawnSync("pkill", ["-9", "-f", "restate-server"]);
  if (opts.dockerContainer) {
    spawnSync("docker", ["rm", "-f", opts.dockerContainer], { encoding: "utf8" });
  }
  const ports = [
    harnessPorts.ingress,
    harnessPorts.admin,
    harnessPorts.service,
    ...EXTRA_HARNESS_PORTS,
  ];
  for (const port of ports) {
    killListenersOnPort(port);
  }
  await waitForHarnessPortsDown(45000);
  await waitForRestateDown(5000);
}

/** Gate entry: exclusive lock + ports fully down before bind/register. */
export async function enterHarnessGate(opts: HarnessTeardownOptions = {}): Promise<void> {
  await acquireHarnessLock();
  await harnessTeardown(opts);
  await sleep(500);
}

/** Gate exit: reap children, free ports, release lock for the next gate. */
export async function exitHarnessGate(opts: HarnessTeardownOptions = {}): Promise<void> {
  await harnessTeardown(opts);
  releaseHarnessLock();
}

/** Start restate-server after ports are free; wait until admin health is up. */
export async function startRestateServerAndWait(
  timeoutMs = 90000,
): Promise<ChildProcess> {
  if (!(await waitForPortDown(harnessPorts.admin, 15000))) {
    throw new Error(`admin port ${harnessPorts.admin} still in use`);
  }
  const server = startRestateServer();
  if (!(await waitForRestate(timeoutMs))) {
    killProc(server);
    throw new Error("restate-server failed to become healthy");
  }
  return server;
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

/** Wait until nothing is listening on the SDK service port (post-SIGKILL cleanup). */
export async function waitForServiceDown(timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await tcpOpen(config.servicePort, 500))) return true;
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

/** registerDeployment with bounded retries — admin can lag after service SIGKILL storms. */
export async function registerDeploymentWithRetry(
  tries = 12,
): Promise<{ ok: boolean; out: string }> {
  let last = { ok: false, out: "" };
  for (let i = 0; i < tries; i++) {
    await waitForRestate(8000);
    await waitForService(8000);
    last = registerDeployment();
    if (last.ok) return last;
    await sleep(800 + i * 200);
  }
  return last;
}

/** Kill processes listening on a port (not clients with outbound connections to it). */
function killListenersOnPort(port: number): void {
  spawnSync("sh", [
    "-c",
    `lsof -nP -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null | xargs kill -9 2>/dev/null || true`,
  ]);
}

/** Reap stale SDK children so TCP bind + deployment register stay deterministic. */
export function killStaleServiceProcesses(): void {
  spawnSync("pkill", ["-9", "-f", "dist/service.js"]);
  killListenersOnPort(config.servicePort);
}

/** @deprecated Prefer `await harnessTeardown()` — sync best-effort kill only. */
export function freeHarnessPorts(): void {
  killStaleServiceProcesses();
  spawnSync("pkill", ["-9", "-f", "restate-server"]);
  for (const port of [
    harnessPorts.ingress,
    harnessPorts.admin,
    harnessPorts.service,
    ...EXTRA_HARNESS_PORTS,
  ]) {
    killListenersOnPort(port);
  }
}

/** Start SDK service and register deployment (shared harness helper). */
export async function startAndRegisterService(
  env: Record<string, string> = {},
): Promise<ServiceHandle> {
  killStaleServiceProcesses();
  await waitForServiceDown(20000);
  if (!(await waitForRestate(45000))) {
    throw new Error("restate admin not reachable before deployment register");
  }
  const svc = startService(env);
  if (!(await waitForService(30000))) throw new Error("service did not come up");
  const reg = await registerDeploymentWithRetry(12);
  if (!reg.ok) throw new Error("register failed: " + reg.out);
  return svc;
}

export function killProc(proc: ChildProcess): void {
  try {
    if (!proc.pid || proc.exitCode !== null) return;
    if (!isPidAlive(proc.pid)) return;
    process.kill(proc.pid, "SIGKILL");
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
