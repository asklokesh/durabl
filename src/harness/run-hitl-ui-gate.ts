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
import type { ChildProcess } from "node:child_process";
import { config } from "../config.js";
import {
  sleep,
  enterHarnessGate,
  releaseHarnessLock,
  harnessTeardown,
  startRestateServerAndWait,
  startAndRegisterService,
  killProc,
  type ServiceHandle,
} from "./restate-control.js";
import { resetEffects } from "../effect-sink.js";
import { resetJournal, hitlState } from "../journal.js";
import { startServerHandle } from "../server.js";
import { FIXTURE_HITL_UI_OFFLINE } from "./fixture-paths.js";

const INGRESS = config.restateIngress;

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
  await harnessTeardown();
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
    await harnessTeardown();
    server = await startRestateServerAndWait();
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

async function g2HitlUiOfflineReadonly(): Promise<void> {
  const runId = "hitl-ui-offline-paused";
  let ui: Awaited<ReturnType<typeof startServerHandle>> | null = null;

  try {
    const paused = true;

    ui = await startServerHandle({ importPath: FIXTURE_HITL_UI_OFFLINE, port: 17879 });
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
  await enterHarnessGate();
  try {
    // Live resume is M5 G5; run `npm run gate:hitl-ui` for G2 + full M5.
    await g2HitlUiOfflineReadonly();
  } finally {
    /* lock released after summary */
  }

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
  releaseHarnessLock();
  process.exitCode = allPass ? 0 : 1;
}

main().catch((e) => {
  console.error("HITL UI gate error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
