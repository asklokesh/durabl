// ─────────────────────────────────────────────────────────────────────────────
// M5 GATE — HUMAN-IN-THE-LOOP (HITL) + STATE EXPORT (real evidence, 1 command).
//
//   npm run gate:m5
//
// Proves the literal M5 bar with REAL evidence — real persistence, real process
// EXIT + RESTART (not an in-process await), real SIGKILL on the resume crash
// path. No mocks on the crash/restart paths.
//
//   G1 pause → process-exit → restart → resume → complete:
//       Start a HITL run; it advances to the durable pause and SUSPENDS. Assert
//       the run is durably paused FROM THE JOURNAL (no live process needed). Then
//       KILL the SDK service process AND the restate-server entirely (assert pids
//       dead, health unreachable) while the run is paused. Start a FRESH server +
//       FRESH service process, supply human input, and the run RESUMES from the
//       pause point and completes. Assert: prior side effects did NOT re-fire
//       (exactly-once preserved) and the post-resume tool effect fired exactly
//       once; the human decision is folded into the result.
//
//   G2 crash-during-resume (SIGKILL at the dual-write boundary):
//       Pause, kill the substrate, restart, supply input — the resuming service
//       SIGKILLs itself at the after-effect window. Restart again, recover →
//       STILL exactly-once.
//
//   G3 double-submit human input → resumes once, no double-fire:
//       Pause, then call provideInput TWICE (same + a different decision). The
//       run resumes ONCE, the tool effect fires ONCE, the journaled human input
//       is the FIRST decision, and the duplicate submit is reported not-accepted.
//
//   G4 full-journal export → offline replay reconstructs the HITL run:
//       Export the completed HITL run bundle; KILL the substrate; reconstruct
//       from the export ALONE (no substrate) byte-identical to live, including
//       the hitl_pause + hitl_input events.
//
// Every number is read from real data (the real SQLite effect sink + journal).
// ─────────────────────────────────────────────────────────────────────────────

import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { config } from "../config.js";
import {
  sleep,
  enterHarnessGate,
  releaseHarnessLock,
  harnessTeardown,
  startRestateServerAndWait,
  startAndRegisterService,
  waitForRestateDown,
  killProc,
  type ServiceHandle,
} from "./restate-control.js";
import { countEffects, resetEffects } from "../effect-sink.js";
import {
  resetJournal,
  trajectory,
  hitlState,
  exportBundleJsonl,
} from "../journal.js";
import { importJournalSource, liveJournalSource } from "../journal-source.js";
import { reconstruct, assertReplayMatches } from "../replay.js";
import { startServerHandle } from "../server.js";
import { FIXTURE_M5_HITL } from "./fixture-paths.js";

const INGRESS = config.restateIngress;
const EVID_DIR = join(process.cwd(), "docs", "m5-evidence");
const RUNTIME_HITL_BUNDLE = join(EVID_DIR, "hitl-run-bundle.jsonl");

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

function isProcAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Submit a HITL run one-way (non-blocking) — it will advance to the pause. */
async function hitlSubmit(runId: string, prompt: string, traj = "main"): Promise<void> {
  const res = await fetch(`${INGRESS}/HitlAgentRun/${runId}/run/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, trajectory: traj }),
  });
  if (!res.ok) throw new Error(`submit ${runId} -> ${res.status}: ${await res.text()}`);
}

async function provideInput(
  runId: string,
  decision: string,
): Promise<{ runId: string; accepted: boolean }> {
  const res = await fetch(`${INGRESS}/HitlAgentRun/${runId}/provideInput`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision }),
  });
  if (!res.ok) throw new Error(`provideInput ${runId} -> ${res.status}: ${await res.text()}`);
  return res.json() as Promise<{ runId: string; accepted: boolean }>;
}

/** Block on a (resuming) HITL run via the Restate attach endpoint. */
async function waitForCompletion(runId: string, timeoutMs = 40000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${INGRESS}/restate/workflow/HitlAgentRun/${runId}/attach`);
      if (res.ok) return res.json();
    } catch {
      /* server/service mid-restart */
    }
    await sleep(500);
  }
  throw new Error(`run ${runId} did not complete within ${timeoutMs}ms`);
}

/** Poll the JOURNAL until the run is durably paused (no live process needed). */
async function waitForPaused(runId: string, timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (hitlState(runId) === "paused") return true;
    await sleep(200);
  }
  return false;
}

/** Kill the SDK service + the restate-server ENTIRELY and confirm dead. */
async function killSubstrate(svc: ServiceHandle, server: ChildProcess): Promise<{ dead: boolean }> {
  killProc(svc.proc);
  killProc(server);
  await harnessTeardown();
  const restateDead = await waitForRestateDown(8000);
  const svcDead = !isProcAlive(svc.pid) && !isProcAlive(server.pid ?? -1);
  return { dead: restateDead && svcDead };
}

/** Fully stop restate and wait until harness ports are free (in-gate restart). */
async function stopServer(server: ChildProcess | null): Promise<void> {
  if (server) killProc(server);
  await harnessTeardown();
}

/** Bring up a FRESH restate-server on the SAME data dir (recovers suspensions). */
async function startServer(): Promise<ChildProcess> {
  await harnessTeardown();
  return startRestateServerAndWait();
}

// ─── G1: pause → process-exit → restart → resume → complete ───────────────────
async function g1(): Promise<void> {
  const runId = `m5-hitl-${Date.now()}`;
  let server = await startServer();
  let svc = await startAndRegisterService();

  await hitlSubmit(runId, "ship-it", "main");
  const paused = await waitForPaused(runId, 20000);

  // The durable paused state, asserted PURELY from the journal:
  const pausedStateFromJournal = hitlState(runId) === "paused";
  const effectsWhilePaused = countEffects(runId, "step4-tool_call");

  // KILL THE WHOLE SUBSTRATE while paused — prove no in-memory dependency.
  const killed = await killSubstrate(svc, server);

  // The journal STILL reports paused with the substrate fully dead — the pause
  // is durable state, not an in-memory promise.
  const pausedAfterKill = hitlState(runId) === "paused";

  // ── REAL PROCESS RESTART: fresh server + fresh service process ────────────
  server = await startServer();
  svc = await startAndRegisterService();

  // Supply human input from the fresh process → the run resumes & completes.
  const decision = "APPROVED-by-human";
  const sub = await provideInput(runId, decision);
  const result = await waitForCompletion(runId, 30000);

  const steps = trajectory(runId);
  const stepNames = steps.map((s) => s.stepName);
  const planEffects = countEffects(runId, "step1-plan"); // never side-effecting
  const toolEffects = countEffects(runId, "step4-tool_call"); // fires once post-resume
  const resumedState = hitlState(runId) === "resumed";
  const humanInJournal =
    steps.find((s) => s.kind === "hitl_input")?.output === decision;
  const answerHasHuman =
    typeof result?.answer === "string" && result.answer.includes(decision);
  const completed =
    stepNames.includes("step1-plan") &&
    stepNames.includes("hitl-pause") &&
    stepNames.includes("hitl-input") &&
    stepNames.includes("step4-tool_call") &&
    stepNames.includes("step5-summarize");

  const pass =
    paused &&
    pausedStateFromJournal &&
    effectsWhilePaused === 0 &&
    killed.dead &&
    pausedAfterKill &&
    sub.accepted === true &&
    completed &&
    planEffects === 0 &&
    toolEffects === 1 &&
    resumedState &&
    humanInJournal &&
    answerHasHuman;

  record(
    "G1 pause→exit→restart→resume→complete",
    pass,
    `paused_from_journal=${pausedStateFromJournal} effects_while_paused=${effectsWhilePaused}(expect 0) ` +
      `substrate_fully_killed=${killed.dead} still_paused_after_kill=${pausedAfterKill} ` +
      `resumed_after_restart=${resumedState} input_accepted=${sub.accepted} ` +
      `prior_side_effects_refired=${planEffects !== 0} post_resume_tool_effects=${toolEffects}(expect 1) ` +
      `human_in_journal=${humanInJournal} answer_has_human_decision=${answerHasHuman} ` +
      `steps=[${stepNames.join(",")}] result=${JSON.stringify(result?.answer ?? result)}`,
  );

  killProc(svc.proc);
  await stopServer(server);
  await sleep(300);
}

// ─── G2: crash-during-resume (SIGKILL at dual-write boundary) → exactly-once ──
async function g2(): Promise<void> {
  const runId = `m5-crash-${Date.now()}`;
  const crashPoint = "on-resume:after-effect"; // effect fired, journal not committed
  let server = await startServer();
  // Service crashes ONCE at the dangerous window during resume.
  let svc = await startAndRegisterService({ DURABL_CRASH_AT: crashPoint, DURABL_CRASH_ONCE: "1" });

  await hitlSubmit(runId, "crash-on-resume", "main");
  const paused = await waitForPaused(runId, 20000);

  // Supply input → the resuming run SIGKILLs itself at the dual-write window.
  await provideInput(runId, "APPROVED-crash");
  // Wait for the service to actually die.
  const killDeadline = Date.now() + 15000;
  while (isProcAlive(svc.pid) && Date.now() < killDeadline) await sleep(150);
  const died = !isProcAlive(svc.pid);

  // Restart the service (CRASH_ONCE marker persists → won't re-crash) → recover.
  killProc(svc.proc);
  await sleep(400);
  svc = await startAndRegisterService({ DURABL_CRASH_AT: crashPoint, DURABL_CRASH_ONCE: "1" });

  const result = await waitForCompletion(runId, 30000);
  const toolEffects = countEffects(runId, "step4-tool_call");
  const resumedState = hitlState(runId) === "resumed";
  const steps = trajectory(runId).map((s) => s.stepName);
  const completed = steps.includes("step4-tool_call") && steps.includes("step5-summarize");

  const pass = paused && died && toolEffects === 1 && resumedState && completed;
  record(
    "G2 crash-during-resume → exactly-once",
    pass,
    `paused=${paused} service_really_died_at_${crashPoint}=${died} ` +
      `tool_effects=${toolEffects}(expect 1) resumed=${resumedState} completed=${completed} ` +
      `result=${JSON.stringify(result?.answer ?? result)}`,
  );

  killProc(svc.proc);
  await stopServer(server);
  await sleep(300);
}

// ─── G3: double-submit human input → resumes once, no double-fire ─────────────
async function g3(): Promise<void> {
  const runId = `m5-double-${Date.now()}`;
  const server = await startServer();
  const svc = await startAndRegisterService();

  await hitlSubmit(runId, "double-submit", "main");
  const paused = await waitForPaused(runId, 20000);

  const firstDecision = "APPROVED-first";
  const sub1 = await provideInput(runId, firstDecision);
  // Double-submit (same value) AND a conflicting value — both must be no-ops.
  const sub2 = await provideInput(runId, firstDecision);
  const sub3 = await provideInput(runId, "REJECTED-second-attempt");

  const result = await waitForCompletion(runId, 30000);
  const toolEffects = countEffects(runId, "step4-tool_call");
  const journaledInput = trajectory(runId).find((s) => s.kind === "hitl_input")?.output;
  const inputStepCount = trajectory(runId).filter((s) => s.kind === "hitl_input").length;

  const pass =
    paused &&
    sub1.accepted === true &&
    sub2.accepted === false &&
    sub3.accepted === false &&
    toolEffects === 1 &&
    inputStepCount === 1 &&
    journaledInput === firstDecision;
  record(
    "G3 double-submit → idempotent (resumes once)",
    pass,
    `paused=${paused} first_accepted=${sub1.accepted}(expect true) ` +
      `dup_accepted=${sub2.accepted}(expect false) conflicting_accepted=${sub3.accepted}(expect false) ` +
      `tool_effects=${toolEffects}(expect 1) hitl_input_steps=${inputStepCount}(expect 1) ` +
      `journaled_input=${JSON.stringify(journaledInput)}(expect ${JSON.stringify(firstDecision)}) ` +
      `result=${JSON.stringify(result?.answer ?? result)}`,
  );

  killProc(svc.proc);
  await stopServer(server);
  await sleep(300);
}

// ─── G4: full-journal export → offline replay reconstructs the HITL run ───────
async function g4(): Promise<void> {
  const runId = `m5-export-${Date.now()}`;
  let server = await startServer();
  let svc = await startAndRegisterService();

  // Produce a COMPLETE HITL run: submit, pause, resume to completion.
  await hitlSubmit(runId, "exportable", "main");
  await waitForPaused(runId, 20000);
  await provideInput(runId, "APPROVED-export");
  await waitForCompletion(runId, 30000);

  // Snapshot the LIVE reconstruction before killing the substrate.
  const live = liveJournalSource();
  const liveReplay = reconstruct(live, runId);

  // Export the full HITL run (run_meta + every step incl. HITL events + effects).
  const bundle = exportBundleJsonl(runId);
  mkdirSync(EVID_DIR, { recursive: true });
  writeFileSync(RUNTIME_HITL_BUNDLE, bundle, "utf8");
  console.log(
    `# exported HITL run bundle (${bundle.split("\n").length} lines) → ${RUNTIME_HITL_BUNDLE} ` +
      `(committed fixture: ${FIXTURE_M5_HITL})\n`,
  );

  // KILL THE SUBSTRATE ENTIRELY.
  const killed = await killSubstrate(svc, server);
  console.log(`# substrate killed: dead=${killed.dead}\n`);

  // Reconstruct from the EXPORT ALONE — no substrate, no SQLite.
  const imp = importJournalSource(bundle, "imported:hitl-run-bundle.jsonl");
  const impReplay = reconstruct(imp, runId);
  const div = assertReplayMatches(liveReplay, impReplay);

  const offlineSteps = impReplay.steps.map((s) => s.stepName);
  const hasPauseOffline = impReplay.steps.some((s) => s.kind === "hitl_pause");
  const hasInputOffline = impReplay.steps.some((s) => s.kind === "hitl_input");
  const offlineOrigin = impReplay.reconstructedFrom.startsWith("imported");
  const offlineEffects = impReplay.effects.length;

  const pass =
    killed.dead &&
    div.identical &&
    hasPauseOffline &&
    hasInputOffline &&
    offlineOrigin &&
    offlineEffects === 1;
  record(
    "G4 full-journal export → offline HITL replay",
    pass,
    `substrate_dead=${killed.dead} reconstructed_from=${impReplay.reconstructedFrom} ` +
      `replay_divergence=${div.identical ? "none" : div.differences.join("; ")} ` +
      `hitl_pause_in_export=${hasPauseOffline} hitl_input_in_export=${hasInputOffline} ` +
      `offline_effects=${offlineEffects}(expect 1) steps=[${offlineSteps.join(",")}]`,
  );

  // server already dead from killSubstrate; nothing to kill.
}

// ─── G5: HITL web UI — paused list + resume via HTTP API (live, no browse daemon) ─
async function g5HitlWebUiApi(): Promise<void> {
  const runId = `m5-ui-${Date.now()}`;
  const uiPort = 17878;
  let server = await startServer();
  let svc = await startAndRegisterService();
  let ui: Awaited<ReturnType<typeof startServerHandle>> | null = null;

  try {
    await hitlSubmit(runId, "ui-api-resume", "main");
    const paused = await waitForPaused(runId, 20000);
    ui = await startServerHandle({ port: uiPort });

    const pausedRes = (await fetch(`${ui.url}/api/hitl/paused`).then((r) => r.json())) as {
      submitEnabled?: boolean;
      paused?: { runId: string }[];
    };
    const listed = pausedRes.paused?.some((p) => p.runId === runId) ?? false;
    const decision = "APPROVED-VIA-WEB-UI";
    const submitRes = await fetch(`${ui.url}/api/hitl/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId, decision }),
    });
    const submitBody = (await submitRes.json()) as { accepted?: boolean };
    await waitForCompletion(runId, 45000);
    const resumed = hitlState(runId) === "resumed";
    const toolEffects = countEffects(runId, "step4-tool_call");

    const pass =
      paused &&
      pausedRes.submitEnabled === true &&
      listed &&
      submitRes.ok &&
      submitBody.accepted === true &&
      resumed &&
      toolEffects === 1;

    record(
      "G5 hitl-web-ui-api-resume",
      pass,
      `paused=${paused} listed=${listed} submit_http=${submitRes.status} accepted=${submitBody.accepted} ` +
        `resumed=${resumed} tool_effects=${toolEffects}(expect 1)`,
    );
  } finally {
    if (ui) await ui.close();
    killProc(svc.proc);
    await stopServer(server);
    await sleep(300);
  }
}

async function main(): Promise<void> {
  await enterHarnessGate();
  rmSync(config.restateDataDir, { recursive: true, force: true });
  resetEffects();
  resetJournal();
  spawnSync("rm", ["-rf", process.env.DURABL_CRASH_MARKER_DIR ?? "/tmp/durabl-m1/markers"]);

  try {
    await g1();
    await g2();
    await g3();
    await g4();
    await g5HitlWebUiApi();
  } finally {
    /* ports/server cleaned at next enterHarnessGate */
  }

  console.log("================ M5 GATE SUMMARY ================");
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
  console.error("M5 GATE ERROR:", e);
  process.exitCode = 3;
});
