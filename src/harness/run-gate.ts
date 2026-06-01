// ─────────────────────────────────────────────────────────────────────────────
// ADVERSARIAL M1 VERIFICATION GATE — single-command, CI-suitable.
//
//   npm test    (== npm run gate)
//
// Drives REAL crashes (SIGKILL of the SDK service process) at EVERY step
// boundary — including the dangerous "after the effect fires, before the journal
// commits" window — and asserts the side effect fired EXACTLY ONCE on recovery,
// read from the REAL idempotent effect sink. Then verifies a concurrent-worker
// race, plus fork + replay determinism (the M2/M3 foundation). No mocks on the
// crash path: the kill is an uncatchable OS SIGKILL and "service_really_died" is
// asserted via process.kill(pid, 0).
// ─────────────────────────────────────────────────────────────────────────────

import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
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
import { countEffects, resetEffects } from "../effect-sink.js";
import { forkRun, resetJournal, runMeta, trajectory } from "../journal.js";

const INGRESS = config.restateIngress;

interface GateResult {
  name: string;
  pass: boolean;
  detail: string;
}
const results: GateResult[] = [];
function record(name: string, pass: boolean, detail: string): void {
  results.push({ name, pass, detail });
  console.log(`\n[GATE ${pass ? "PASS" : "FAIL"}] ${name}\n  ${detail}`);
}

function invokeAsync(runId: string, prompt: string, traj = "main"): void {
  void fetch(`${INGRESS}/AgentRun/${runId}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, trajectory: traj }),
  }).catch(() => {});
}

async function invokeSync(runId: string, prompt: string, traj = "main"): Promise<any> {
  const res = await fetch(`${INGRESS}/AgentRun/${runId}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, trajectory: traj }),
  });
  if (!res.ok) throw new Error(`invoke ${runId} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

// Block on an existing (recovering) run via the Restate attach endpoint — does
// NOT submit a new invocation. Retries across server/service restarts.
async function waitForCompletion(runId: string, timeoutMs = 40000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${INGRESS}/restate/workflow/AgentRun/${runId}/attach`);
      if (res.ok) return res.json();
    } catch {
      /* server/service mid-restart */
    }
    await sleep(500);
  }
  throw new Error(`run ${runId} did not complete within ${timeoutMs}ms`);
}

function isProcAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function startAndRegister(env: Record<string, string>): Promise<ServiceHandle> {
  const svc = startService(env);
  if (!(await waitForService(15000))) throw new Error("service did not come up");
  const reg = registerDeployment();
  if (!reg.ok) throw new Error("register failed: " + reg.out);
  return svc;
}

const CRASH_POINTS = [
  "before:step1",
  "after:step1",
  "before-effect:step2",
  "after-effect:step2", // the dangerous dual-write window
  "after:step2",
  "before:step3",
  "after:step3",
] as const;

async function crashGate(point: string): Promise<void> {
  const runId = `crash-${point.replace(/[^a-z0-9]/gi, "_")}-${Date.now()}`;

  // Phase 1: service will SIGKILL itself once at `point`.
  let svc = await startAndRegister({ DURABL_CRASH_AT: point, DURABL_CRASH_ONCE: "1" });
  invokeAsync(runId, "crashy");

  const killDeadline = Date.now() + 15000;
  while (isProcAlive(svc.pid) && Date.now() < killDeadline) await sleep(150);
  const died = !isProcAlive(svc.pid);

  // Phase 2: restart. CRASH_ONCE marker persists so it won't re-crash; recover.
  killProc(svc.proc);
  await sleep(300);
  svc = await startAndRegister({ DURABL_CRASH_AT: point, DURABL_CRASH_ONCE: "1" });

  const result = await waitForCompletion(runId, 30000);

  const effectCount = countEffects(runId, "step2-tool_call");
  const steps = trajectory(runId).map((e) => e.stepName);
  const completed =
    steps.includes("step1-plan") &&
    steps.includes("step2-tool_call") &&
    steps.includes("step3-summarize");

  const pass = died && effectCount === 1 && completed;
  record(
    `crash@${point}`,
    pass,
    `service_really_died=${died} effect_fires=${effectCount} (expect 1) ` +
      `journal_steps=[${steps.join(",")}] result=${JSON.stringify(result?.answer ?? result)}`,
  );

  killProc(svc.proc);
  await sleep(200);
}

async function concurrencyGate(): Promise<void> {
  const svc = await startAndRegister({});
  const runId = `concurrent-${Date.now()}`;

  // N workers race on the SAME workflow key. Restate's run-once-per-key must
  // collapse them: exactly one side effect, one journal trajectory, no
  // corruption. The journal's (run_id, idem_key) UNIQUE index is a second guard.
  const N = 8;
  const settled = await Promise.all(
    Array.from({ length: N }, () =>
      invokeSync(runId, "race").catch((e) => ({ error: String(e) })),
    ),
  );

  const effectCount = countEffects(runId, "step2-tool_call");
  const traj = trajectory(runId);
  const distinctAnswers = new Set(
    settled.filter((s: any) => s && s.answer).map((s: any) => s.answer),
  );

  const pass = effectCount === 1 && traj.length === 3 && distinctAnswers.size <= 1;
  record(
    "concurrent-workers",
    pass,
    `workers=${N} effect_fires=${effectCount}(expect 1) journal_len=${traj.length}(expect 3) ` +
      `distinct_answers=${distinctAnswers.size}(expect 1)`,
  );

  killProc(svc.proc);
  await sleep(200);
}

async function forkGate(): Promise<void> {
  const svc = await startAndRegister({});
  const source = `fork-src-${Date.now()}`;
  const srcResult = await invokeSync(source, "original");
  const srcEffectsBefore = countEffects(source, "step2-tool_call");

  // Fork from seq N=2 (after the side-effecting tool call) onto a new path.
  const forked = `fork-new-${Date.now()}`;
  const seeded = forkRun({
    sourceRunId: source,
    newRunId: forked,
    throughSeq: 2,
    newTrajectory: "what-if",
  });
  const forkResult = await invokeSync(forked, "diverged-prompt", "what-if");

  const srcEffectsAfter = countEffects(source, "step2-tool_call");
  const forkEffects = countEffects(forked, "step2-tool_call");
  const srcTraj = trajectory(source);
  const forkTraj = trajectory(forked);
  const fmeta = runMeta(forked);

  const seededOk = seeded === 2;
  const noRefire = srcEffectsBefore === 1 && srcEffectsAfter === 1 && forkEffects === 0;
  const reconstructable = srcTraj.length === 3 && forkTraj.length === 3;
  const seq2Same =
    JSON.stringify(srcTraj.find((e) => e.seq === 2)?.output) ===
    JSON.stringify(forkTraj.find((e) => e.seq === 2)?.output);
  const diverged = srcResult.answer !== forkResult.answer;
  const parentLinked = fmeta?.parentRun === source && fmeta?.forkedAtSeq === 2;

  const pass =
    seededOk && noRefire && reconstructable && seq2Same && diverged && parentLinked;
  record(
    "fork-correctness",
    pass,
    `seeded=${seeded}(expect 2) src_effects=${srcEffectsAfter}(expect 1) ` +
      `fork_NEW_effects=${forkEffects}(expect 0) step2_output_identical=${seq2Same} ` +
      `diverged_answer=${diverged} parent_linked=${parentLinked} ` +
      `src_answer=${JSON.stringify(srcResult.answer)} fork_answer=${JSON.stringify(forkResult.answer)}`,
  );

  killProc(svc.proc);
  await sleep(200);
}

async function replayGate(): Promise<void> {
  const svc = await startAndRegister({});
  const runId = `replay-${Date.now()}`;
  const first = await invokeSync(runId, "deterministic");
  const trajFirst = trajectory(runId).map((e) => `${e.seq}:${e.stepName}=${JSON.stringify(e.output)}`);
  const effectsFirst = countEffects(runId, "step2-tool_call");

  const second = await waitForCompletion(runId, 10000);
  const trajSecond = trajectory(runId).map((e) => `${e.seq}:${e.stepName}=${JSON.stringify(e.output)}`);
  const effectsSecond = countEffects(runId, "step2-tool_call");

  const sameSeq = JSON.stringify(trajFirst) === JSON.stringify(trajSecond);
  const sameAnswer = first.answer === second.answer;
  const noExtraEffect = effectsFirst === 1 && effectsSecond === 1;

  const pass = sameSeq && sameAnswer && noExtraEffect;
  record(
    "replay-determinism",
    pass,
    `same_step_sequence=${sameSeq} same_answer=${sameAnswer} ` +
      `effects(first=${effectsFirst},second=${effectsSecond}; expect 1,1)`,
  );

  killProc(svc.proc);
  await sleep(200);
}

async function main(): Promise<void> {
  const only = process.argv[2]; // optional: crash | concurrency | fork | replay

  // Defensive: kill stale engine/service so a fresh data dir is not yanked out
  // from under a live server.
  spawnSync("pkill", ["-9", "-f", "restate-server"]);
  spawnSync("pkill", ["-9", "-f", "dist/service.js"]);
  await sleep(1500);
  rmSync(config.restateDataDir, { recursive: true, force: true });
  resetEffects();
  resetJournal();
  spawnSync("rm", ["-rf", process.env.DURABL_CRASH_MARKER_DIR ?? "/tmp/durabl-m1/markers"]);

  console.log("Starting restate-server (single self-hostable binary)...");
  const server = startRestateServer();
  if (!(await waitForRestate(60000))) {
    console.error("restate-server failed to become healthy");
    killProc(server);
    process.exit(2);
  }
  console.log("restate-server healthy.");

  try {
    if (!only || only === "crash") {
      for (const p of CRASH_POINTS) await crashGate(p);
    }
    if (!only || only === "concurrency") await concurrencyGate();
    if (!only || only === "fork") await forkGate();
    if (!only || only === "replay") await replayGate();
  } finally {
    killProc(server);
    // Reap any stale engine/service children so the process exits cleanly (no
    // lingering pipe holding the parent open in CI).
    spawnSync("pkill", ["-9", "-f", "restate-server"]);
    spawnSync("pkill", ["-9", "-f", "dist/service.js"]);
  }

  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  console.log(`\n================ M1 GATE SUMMARY ================`);
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
  console.log(`------------------------------------------------`);
  console.log(`${passed}/${total} gates passed`);
  console.log(`VERDICT: ${passed === total ? "GATE PASSED" : "GATE FAILED"}`);
  console.log(`================================================`);

  process.exitCode = passed === total ? 0 : 1;
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exitCode = 3;
});
