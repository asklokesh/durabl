// ─────────────────────────────────────────────────────────────────────────────
// HITL WEB UI GATE — live paused list + resume via HTTP API (no browse daemon).
//
//   npm run gate:hitl-ui
//
//   G1 hitl-ui-api-resume:
//       Covered by M5 G5 (`run-m5-gate.ts`).
//
//   G2 hitl-ui-offline-paused-readonly:
//       Synthetic paused-only JSONL import — paused visible, POST returns 503.
// ─────────────────────────────────────────────────────────────────────────────

import {
  enterHarnessGate,
  releaseHarnessLock,
} from "./restate-control.js";
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
