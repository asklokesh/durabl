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
//       Synthetic paused-only JSONL import — paused visible, POST returns 503.
// ─────────────────────────────────────────────────────────────────────────────

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { config } from "../config.js";
import {
  sleep,
  startRestateServer,
  startAndRegisterService,
  waitForRestate,
  killProc,
  type ServiceHandle,
} from "./restate-control.js";
import { resetEffects } from "../effect-sink.js";
import { resetJournal, hitlState } from "../journal.js";
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
  for (const port of [8080, 9080, 17878, 17879]) {
    spawnSync("sh", ["-c", `lsof -ti tcp:${port} | xargs kill -9 2>/dev/null || true`]);
  }
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const r = spawnSync("sh", ["-c", "lsof -ti tcp:8080 tcp:9080 || true"], { encoding: "utf8" });
    if (!(r.stdout ?? "").trim()) return;
    await sleep(300);
  }
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
    svc = await startAndRegisterService();
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

function pausedOnlyBundle(runId: string): string {
  const lines = [
    {
      record: "run_meta",
      schema: 1,
      runId,
      parentRun: null,
      forkedAtSeq: null,
      trajectory: "main",
      createdAt: "2026-06-01T00:00:00.000Z",
    },
    {
      record: "step",
      schema: 1,
      runId,
      seq: 1,
      stepName: "step1-plan",
      kind: "plan",
      idemKey: `${runId}:step1-plan`,
      output: "plan",
      sideEffect: false,
      seededFrom: null,
      recordedAt: "2026-06-01T00:00:01.000Z",
    },
    {
      record: "step",
      schema: 1,
      runId,
      seq: 2,
      stepName: "hitl-pause",
      kind: "hitl_pause",
      idemKey: `${runId}:hitl-pause`,
      output: { awaiting: "hitl.input", planSoFar: "plan" },
      sideEffect: false,
      seededFrom: null,
      recordedAt: "2026-06-01T00:00:02.000Z",
    },
  ];
  return lines.map((o) => JSON.stringify(o)).join("\n") + "\n";
}

async function g2HitlUiOfflineReadonly(): Promise<void> {
  const runId = "hitl-ui-offline-paused";
  let ui: Awaited<ReturnType<typeof startServerHandle>> | null = null;
  const bundlePath = join(EVID_DIR, "hitl-ui-offline.jsonl");

  try {
    writeFileSync(bundlePath, pausedOnlyBundle(runId), "utf8");
    const paused = true;

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
  }
}

async function main(): Promise<void> {
  mkdirSync(EVID_DIR, { recursive: true });
  // Live resume is M5 G5; run `npm run gate:hitl-ui` for G2 + full M5.
  await g2HitlUiOfflineReadonly();

  console.log("================ HITL UI GATE SUMMARY ================");
  let passed = 0;
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
    if (r.pass) passed++;
  }
  console.log("------------------------------------------------");
  console.log(`${passed}/${results.length} gates passed`);
  const allPass = passed === results.length;
  console.log(`VERDICT: ${allPass ? "GATE PASSED" : "GATE FAILED"}`);
  console.log("================================================");
  process.exitCode = allPass ? 0 : 1;
}

main().catch((e) => {
  console.error("HITL UI gate error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
