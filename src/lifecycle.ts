// Process lifecycle: cooperative shutdown on SIGTERM/SIGINT for long-running servers
// and in-flight Restate ingress traffic (fetch + SDK clients).

import type { Server as HttpServer } from "node:http";
import type { Http2Server } from "node:http2";

const DEFAULT_SHUTDOWN_MS = Number(process.env.DURABL_SHUTDOWN_TIMEOUT_MS ?? 30_000);

type ShutdownHook = () => void | Promise<void>;

const hooks: ShutdownHook[] = [];
let signalsInstalled = false;
let shuttingDown = false;

/** Aborted when the process begins graceful shutdown (ingress fetch uses this). */
export const shutdownAbort = new AbortController();

export function registerGracefulShutdown(hook: ShutdownHook): void {
  hooks.push(hook);
}

export function installSignalHandlers(): void {
  if (signalsInstalled) return;
  signalsInstalled = true;
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.once(sig, () => {
      void gracefulShutdown(sig);
    });
  }
}

async function gracefulShutdown(reason: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  shutdownAbort.abort(new Error(`shutdown: received ${reason}`));

  const deadline = Date.now() + DEFAULT_SHUTDOWN_MS;
  for (const hook of [...hooks].reverse()) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await Promise.race([
      Promise.resolve().then(hook),
      sleep(remaining),
    ]);
  }

  process.exit(0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Close an HTTP/1 replay UI server. */
export function closeHttpServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

/** Close the Restate SDK HTTP/2 service. */
export function closeHttp2Server(server: Http2Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
