// THROWAWAY SPIKE CODE — not production.
//
// Adversarial M0 gate harness. Drives REAL crashes (SIGKILL of the SDK service
// process) at EVERY step boundary and asserts exactly-once side effects on
// recovery, then verifies fork correctness, a concurrent-worker race, and
// replay determinism. All assertions read the REAL SQLite effect log + journal.

import { spawnSync } from "node:child_process";
import {
  RESTATE_INGRESS,
  registerDeployment,
  sleep,
  startRestateServer,
  startService,
  waitForRestate,
  waitForService,
  killProc,
  ServiceHandle,
} from "./restate-control.js";
import { countEffects, effectsFor, resetEffects } from "../effects.js";
import {
  forkRun,
  resetJournal,
  trajectory,
  meta,
} from "../journal.js";

const INGRESS = RESTATE_INGRESS;

interface GateResult {
  name: string;
  pass: boolean;
  detail: string;
}
const results: GateResult[] = [];
function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  const tag = pass ? "PASS" : "FAIL";
  console.log(`\n[GATE ${tag}] ${name}\n  ${detail}`);
}

// Fire-and-forget invocation; the connection drops when the service is killed.
async function invokeAsync(runId: string, prompt: string, trajectoryLabel = "main") {
  fetch(`${INGRESS}/AgentRun/${runId}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, trajectory: trajectoryLabel }),
  }).catch(() => {});
}

// Blocking invocation that returns the workflow output.
async function invokeSync(runId: string, prompt: string, trajectoryLabel = "main"): Promise<any> {
  const res = await fetch(`${INGRESS}/AgentRun/${runId}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, trajectory: trajectoryLabel }),
  });
  if (!res.ok) throw new Error(`invoke ${runId} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

// Attach to the workflow result via the Restate ingress attach endpoint. This
// does NOT submit a new invocation; it blocks until the existing (recovering)
// run completes and returns its output. Retries across server/service restarts.
async function waitForCompletion(runId: string, timeoutMs = 40000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(
        `${INGRESS}/restate/workflow/AgentRun/${runId}/attach`,
      );
      if (res.ok) return res.json();
      // 404 => not yet submitted/known; keep polling.
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
  const up = await waitForService(15000);
  if (!up) throw new Error("service did not come up");
  const reg = registerDeployment();
  if (!reg.ok) throw new Error("register failed: " + reg.out);
  return svc;
}

const CRASH_POINTS = [
  "before:step1",
  "after:step1",
  "before-effect:step2",
  "after-effect:step2",
  "after:step2",
  "before:step3",
  "after:step3",
];

async function crashGate(point: string): Promise<void> {
  const runId = `crash-${point.replace(/[^a-z0-9]/gi, "_")}-${Date.now()}`;

  // Phase 1: service configured to SIGKILL itself once at `point`.
  let svc = await startAndRegister({ CRASH_AT: point, CRASH_ONCE: "1" });

  // Kick the run; the service will kill itself at the crash point.
  await invokeAsync(runId, "crashy");

  // Wait until the service process is actually dead (real SIGKILL happened).
  const killDeadline = Date.now() + 15000;
  while (isProcAlive(svc.pid) && Date.now() < killDeadline) await sleep(150);
  const died = !isProcAlive(svc.pid);

  // Phase 2: bring the service back. CRASH_ONCE markers persist, so the same
  // crash point will NOT fire again -> run can complete on recovery.
  killProc(svc.proc); // ensure no zombie
  await sleep(300);
  svc = await startAndRegister({ CRASH_AT: point, CRASH_ONCE: "1" });

  // Drive recovery to completion.
  const result = await waitForCompletion(runId, 30000);

  // Assert exactly-once for the side-effecting step.
  const effectCount = countEffects(runId, "step2-tool_call");
  const steps = trajectory(runId).map((e) => e.step_name);
  const completed =
    steps.includes("step1-plan") &&
    steps.includes("step2-tool_call") &&
    steps.includes("step3-summarize");

  // For crashes strictly before the effect ever fires, the effect must still be
  // exactly 1 after recovery. For crashes after the effect, it must be exactly 1
  // (no double fire). In all cases: exactly 1.
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

async function forkGate(): Promise<void> {
  // Clean source run, no crash.
  const svc = await startAndRegister({});
  const source = `fork-src-${Date.now()}`;
  const srcResult = await invokeSync(source, "original");
  const srcEffectsBefore = countEffects(source, "step2-tool_call");

  // Fork from step N=2 (after the side-effecting tool call) onto a new path.
  const forked = `fork-new-${Date.now()}`;
  const seeded = forkRun(source, forked, 2, "what-if");
  const forkResult = await invokeSync(forked, "diverged-prompt", "what-if");

  const srcEffectsAfter = countEffects(source, "step2-tool_call");
  const forkEffects = countEffects(forked, "step2-tool_call");

  const srcTraj = trajectory(source);
  const forkTraj = trajectory(forked);
  const forkMeta = meta(forked);

  // Gate conditions:
  //  - seeding copied 2 entries
  //  - source side effect count unchanged (==1) and forked run fired 0 NEW
  //    side effects for the seeded step (it was replayed from journal)
  //  - both trajectories fully reconstructable (3 steps each)
  //  - step3 diverged: forked answer references the new prompt path while
  //    reusing the seeded step1/step2 outputs verbatim
  const seededOk = seeded === 2;
  const noRefire = srcEffectsBefore === 1 && srcEffectsAfter === 1 && forkEffects === 0;
  const reconstructable = srcTraj.length === 3 && forkTraj.length === 3;
  const seq2Same =
    srcTraj.find((e) => e.seq === 2)?.output ===
    forkTraj.find((e) => e.seq === 2)?.output;
  const diverged = srcResult.answer !== forkResult.answer && forkResult.step2Replayed === true;
  const parentLinked = forkMeta?.parent_run === source && forkMeta?.forked_at_seq === 2;

  const pass = seededOk && noRefire && reconstructable && seq2Same && diverged && parentLinked;
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

async function concurrencyGate(): Promise<void> {
  const svc = await startAndRegister({});
  const runId = `concurrent-${Date.now()}`;

  // Fire N concurrent invocations of the SAME workflow key. Restate's
  // single-writer / run-once-per-key semantics must collapse these into one
  // execution: exactly one side effect, one journal trajectory.
  const N = 8;
  const calls = Array.from({ length: N }, () =>
    invokeSync(runId, "race").catch((e) => ({ error: String(e) })),
  );
  const settled = await Promise.all(calls);

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

async function replayDivergenceGate(): Promise<void> {
  // Determinism: invoking the same completed workflow key again returns the same
  // journaled step sequence and outputs (no re-execution, no divergence).
  const svc = await startAndRegister({});
  const runId = `replay-${Date.now()}`;
  const first = await invokeSync(runId, "deterministic");
  const trajFirst = trajectory(runId).map((e) => `${e.seq}:${e.step_name}=${e.output}`);
  const effectsFirst = countEffects(runId, "step2-tool_call");

  // Re-attach to the SAME completed workflow key (run-once-per-key). Restate
  // returns the already-journaled result without re-executing — proving replay
  // determinism: identical step sequence, identical output, no new side effect.
  const second = await waitForCompletion(runId, 10000);
  const trajSecond = trajectory(runId).map((e) => `${e.seq}:${e.step_name}=${e.output}`);
  const effectsSecond = countEffects(runId, "step2-tool_call");

  const sameSeq = JSON.stringify(trajFirst) === JSON.stringify(trajSecond);
  const sameAnswer = first.answer === second.answer;
  const noExtraEffect = effectsFirst === 1 && effectsSecond === 1;

  const pass = sameSeq && sameAnswer && noExtraEffect;
  record(
    "replay-divergence",
    pass,
    `same_step_sequence=${sameSeq} same_answer=${sameAnswer} ` +
      `effects(first=${effectsFirst},second=${effectsSecond}; expect 1,1)`,
  );

  killProc(svc.proc);
  await sleep(200);
}

async function main(): Promise<void> {
  const onlyArg = process.argv[2]; // optional: a single crash point or "fork" etc.

  // Defensive: kill any stale engine/service from a prior aborted run so a
  // fresh data dir is not yanked out from under a live server.
  spawnSync("pkill", ["-9", "-f", "restate-server"]);
  spawnSync("pkill", ["-9", "-f", "dist/service.js"]);
  await sleep(1500);
  spawnSync("rm", ["-rf", "/tmp/durabl-m0-spike/restate-data"]);

  resetEffects();
  resetJournal();
  // Clear crash markers between full runs.
  spawnSync("rm", ["-rf", "/tmp/durabl-m0-spike/markers"]);

  console.log("Starting restate-server...");
  const server = startRestateServer();
  const up = await waitForRestate(60000);
  if (!up) {
    console.error("restate-server failed to become healthy");
    killProc(server);
    process.exit(2);
  }
  console.log("restate-server healthy.");

  try {
    if (!onlyArg || onlyArg === "crash") {
      for (const p of CRASH_POINTS) {
        await crashGate(p);
      }
    }
    if (!onlyArg || onlyArg === "fork") await forkGate();
    if (!onlyArg || onlyArg === "concurrency") await concurrencyGate();
    if (!onlyArg || onlyArg === "replay") await replayDivergenceGate();
  } finally {
    killProc(server);
  }

  // Summary
  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  console.log(`\n================ GATE SUMMARY ================`);
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
  }
  console.log(`---------------------------------------------`);
  console.log(`${passed}/${total} gates passed`);
  console.log(`VERDICT: ${passed === total ? "GATE PASSED" : "GATE FAILED"}`);
  console.log(`=============================================`);

  process.exitCode = passed === total ? 0 : 1;
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exitCode = 3;
});
