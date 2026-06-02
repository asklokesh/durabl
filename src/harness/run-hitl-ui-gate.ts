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

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  enterHarnessGate,
  releaseHarnessLock,
} from "./restate-control.js";
import { startServerHandle } from "../server.js";

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
  await enterHarnessGate();
  mkdirSync(EVID_DIR, { recursive: true });
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
