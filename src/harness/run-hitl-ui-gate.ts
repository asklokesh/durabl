// HITL WEB UI GATE — G2 offline queue (live resume: M5 G5).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enterHarnessGate, releaseHarnessLock } from "./restate-control.js";
import { closeOfflineHitlQueueForTests } from "../hitl-offline-queue.js";
import { startServerHandle } from "../server.js";
import { FIXTURE_HITL_UI_OFFLINE } from "./fixture-paths.js";

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

async function g2HitlUiOfflineQueue(): Promise<void> {
  const runId = "hitl-ui-offline-paused";
  let ui: Awaited<ReturnType<typeof startServerHandle>> | null = null;
  const dataDir = mkdtempSync(join(tmpdir(), "durabl-g2-hitl-"));
  const prevDataDir = process.env.DURABL_DATA_DIR;
  process.env.DURABL_DATA_DIR = dataDir;
  closeOfflineHitlQueueForTests();

  try {
    ui = await startServerHandle({ importPath: FIXTURE_HITL_UI_OFFLINE, port: 17879 });
    const pausedRes = await fetch(`${ui.url}/api/hitl/paused`).then((r) => r.json()) as {
      submitEnabled?: boolean;
      paused?: { runId: string }[];
    };
    const submitRes = await fetch(`${ui.url}/api/hitl/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId, decision: "APPROVED-OFFLINE-G2" }),
    });
    const submitBody = await submitRes.json() as {
      queued?: boolean;
      accepted?: boolean;
      state?: string;
    };
    const pausedAfter = await fetch(`${ui.url}/api/hitl/paused`).then((r) => r.json()) as {
      paused?: { runId: string }[];
    };

    const pass =
      pausedRes.submitEnabled === true &&
      (pausedRes.paused?.some((p) => p.runId === runId) ?? false) &&
      submitRes.status === 200 &&
      submitBody.queued === true &&
      submitBody.state === "resumed" &&
      !(pausedAfter.paused?.some((p) => p.runId === runId) ?? false);

    record(
      "G2 hitl-ui-offline-paused-queue",
      pass,
      `submitEnabled=${pausedRes.submitEnabled} submit_http=${submitRes.status} ` +
        `queued=${submitBody.queued} state=${submitBody.state}`,
    );
  } finally {
    if (ui) await ui.close();
    closeOfflineHitlQueueForTests();
    rmSync(dataDir, { recursive: true, force: true });
    if (prevDataDir === undefined) delete process.env.DURABL_DATA_DIR;
    else process.env.DURABL_DATA_DIR = prevDataDir;
  }
}

async function main(): Promise<void> {
  await enterHarnessGate();
  try {
    await g2HitlUiOfflineQueue();
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
  console.log(`VERDICT: ${passed === results.length ? "GATE PASSED" : "GATE FAILED"}`);
  console.log("================================================");
  releaseHarnessLock();
  process.exitCode = passed === results.length ? 0 : 1;
}

main().catch((e) => {
  console.error("HITL UI gate error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
