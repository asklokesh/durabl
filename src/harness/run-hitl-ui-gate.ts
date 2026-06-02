// ─────────────────────────────────────────────────────────────────────────────
// HITL WEB UI GATE — live paused list + resume via HTTP API (no browse daemon).
//
//   npm run gate:hitl-ui
//
//   G1 hitl-ui-api-resume:
//       Start a real HITL run on Restate, wait until journal shows paused,
//       start the replay UI server in LIVE mode, assert GET /api/hitl/paused
//       lists the run, POST /api/hitl/input resumes via ingress, run completes.
//
//   G2 hitl-ui-offline-paused-readonly:
//       Export bundle, kill substrate, serve UI from import — paused visible,
//       POST /api/hitl/input returns 503 (submit disabled).
// ─────────────────────────────────────────────────────────────────────────────

import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { config } from "../config.js";
import {
  registerDeployment,
  sleep,
  startRestateServer,
  startService,
  waitForRestate,
  waitForService,
  killProc,
  type ServiceHandle,
} from "./restate-control.js";
import { resetEffects } from "../effect-sink.js";
import {
  resetJournal,
  hitlState,
  exportBundleJsonl,
} from "../journal.js";
import { startServerHandle } from "../server.js";

const INGRESS = config.restateIngress;
const EVID_DIR = join(process.cwd(), "docs", "hitl-ui-evidence");

interface GateResult {
  name: string;
  pass: boolean;
  detail: string;
}
const results: GateResult[] = [];
function record(name: string, pass: boolean, detail: string): void {
  results.push({ name, pass, detail });
  console.log(`[GATE ${pass ? "PASS" : "FAIL"}] ${name}\n  ${detail}\n`);
}

async function stopSubstrate(svc?: ServiceHandle | null, server?: ChildProcess | null): Promise<void> {
  if (svc) killProc(svc.proc);
  if (server) killProc(server);
  spawnSync("pkill", ["-9", "-f", "restate-server"]);
  spawnSync("pkill", ["-9", "-f", "dist/service.js"]);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const r = spawnSync("sh", ["-c", "lsof -ti tcp:8080 || true"], { encoding: "utf8" });
    if (!(r.stdout ?? "").trim()) return;
    spawnSync("sh", ["-c", "lsof -ti tcp:8080 | xargs kill -9 2>/dev/null || true"]);
    await sleep(300);
  }
}

async function startAndRegister(env: Record<string, string> = {}): Promise<ServiceHandle> {
  const svc = startService(env);
  if (!(await waitForService(15000))) throw new Error("service did not come up");
  const reg = registerDeployment();
  if (!reg.ok) throw new Error("register failed: " + reg.out);
  return svc;
}

async function hitlSubmit(runId: string, prompt: string): Promise<void> {
  const res = await fetch(`${INGRESS}/HitlAgentRun/${runId}/run/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, trajectory: "main" }),
  });
  if (!res.ok) throw new Error(`submit ${runId} -> ${res.status}: ${await res.text()}`);
}

async function waitForPaused(runId: string, timeoutMs = 25000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (hitlState(runId) === "paused") return true;
    await sleep(200);
  }
  return false;
}

async function waitForResumed(runId: string, timeoutMs = 40000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (hitlState(runId) === "resumed") return true;
    await sleep(300);
  }
  return false;
}

async function waitForCompletion(runId: string, timeoutMs = 45000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${INGRESS}/restate/workflow/HitlAgentRun/${runId}/attach`);
      if (res.ok) return;
    } catch {
      /* mid-restart */
    }
    await sleep(400);
  }
  throw new Error(`run ${runId} did not complete`);
}

async function g1HitlUiApiResume(): Promise<void> {
  const runId = `hitl-ui-${Date.now()}`;
  const uiPort = 17878;
  let server: ChildProcess | null = null;
  let svc: ServiceHandle | null = null;
  let ui: Awaited<ReturnType<typeof startServerHandle>> | null = null;

  try {
    await stopSubstrate();
    server = startRestateServer();
    if (!(await waitForRestate(60000))) throw new Error("restate-server unhealthy");
    svc = await startAndRegister();
    await hitlSubmit(runId, "ui-gate");
    const paused = await waitForPaused(runId);
    ui = await startServerHandle({ port: uiPort });

    const health = await fetch(`${ui.url}/api/health`).then((r) => r.json()) as {
      live?: boolean;
      hitlSubmitEnabled?: boolean;
    };
    const pausedRes = await fetch(`${ui.url}/api/hitl/paused`).then((r) => r.json()) as {
      submitEnabled?: boolean;
      paused?: { runId: string }[];
    };
    const listed = pausedRes.paused?.some((p) => p.runId === runId) ?? false;

    const decision = "APPROVED-VIA-UI-API";
    const submitRes = await fetch(`${ui.url}/api/hitl/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId, decision }),
    });
    const submitBody = await submitRes.json() as { accepted?: boolean };
    await waitForCompletion(runId);
    const resumed = await waitForResumed(runId);

    const pass =
      paused &&
      health.live === true &&
      health.hitlSubmitEnabled === true &&
      pausedRes.submitEnabled === true &&
      listed &&
      submitRes.ok &&
      submitBody.accepted === true &&
      resumed;

    record(
      "G1 hitl-ui-api-resume",
      pass,
      `journal_paused=${paused} health_live=${health.live} listed_in_ui=${listed} ` +
        `submit_http=${submitRes.status} accepted=${submitBody.accepted} resumed=${resumed}`,
    );
  } finally {
    if (ui) await ui.close();
    await stopSubstrate(svc, server);
  }
}

async function g2HitlUiOfflineReadonly(): Promise<void> {
  const runId = `hitl-ui-off-${Date.now()}`;
  let server: ChildProcess | null = null;
  let svc: ServiceHandle | null = null;
  let ui: Awaited<ReturnType<typeof startServerHandle>> | null = null;
  const bundlePath = join(EVID_DIR, "hitl-ui-offline.jsonl");

  try {
    await stopSubstrate();
    server = startRestateServer();
    if (!(await waitForRestate(60000))) throw new Error("restate-server unhealthy");
    svc = await startAndRegister();
    await hitlSubmit(runId, "offline-export");
    const paused = await waitForPaused(runId);
    const bundle = exportBundleJsonl(runId);
    writeFileSync(bundlePath, bundle, "utf8");

    await stopSubstrate(svc, server);
    await sleep(500);

    ui = await startServerHandle({ importPath: bundlePath, port: 17879 });
    const pausedRes = await fetch(`${ui.url}/api/hitl/paused`).then((r) => r.json()) as {
      submitEnabled?: boolean;
      paused?: { runId: string }[];
    };
    const submitRes = await fetch(`${ui.url}/api/hitl/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId, decision: "SHOULD-FAIL" }),
    });
    const submitBody = await submitRes.json() as { error?: string; submitEnabled?: boolean };

    const pass =
      paused &&
      pausedRes.submitEnabled === false &&
      (pausedRes.paused?.some((p) => p.runId === runId) ?? false) &&
      submitRes.status === 503 &&
      submitBody.submitEnabled === false;

    record(
      "G2 hitl-ui-offline-paused-readonly",
      pass,
      `had_pause_in_export=${paused} submitEnabled=${pausedRes.submitEnabled} ` +
        `submit_http=${submitRes.status} error=${submitBody.error?.slice(0, 60) ?? "n/a"}`,
    );
  } finally {
    if (ui) await ui.close();
    await stopSubstrate(svc, server);
  }
}

async function main(): Promise<void> {
  const dataRoot = join(tmpdir(), `durabl-hitl-ui-gate-${Date.now()}`);
  process.env.DURABL_DATA_DIR = dataRoot;
  rmSync(dataRoot, { recursive: true, force: true });
  mkdirSync(dataRoot, { recursive: true });
  mkdirSync(EVID_DIR, { recursive: true });
  resetJournal();
  resetEffects();
  await g1HitlUiApiResume();
  resetJournal();
  resetEffects();
  await g2HitlUiOfflineReadonly();

  const failed = results.filter((r) => !r.pass);
  console.log("\n── HITL UI GATE SUMMARY ──");
  for (const r of results) console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
  if (failed.length) {
    console.error(`\n${failed.length} gate(s) failed`);
    process.exit(1);
  }
  console.log("\nAll HITL UI gates passed.");
}

main().catch((e) => {
  console.error("HITL UI gate error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
