// ─────────────────────────────────────────────────────────────────────────────
// ADVERSARIAL M2 VERIFICATION GATE — trajectory branching. Single-command,
// CI-suitable:
//
//   npm run gate:m2     (== this file)
//
// Builds on the M1 crash harness style (REAL restate-server + REAL SIGKILL of
// the SDK service — no mocks on the crash path). Verifies the M2 differentiator:
//
//   1. fork-no-refire     fork from step N; seeded effects (seq<=N) fire ZERO
//                         additional times (fork_NEW_effects=0) AND the forked
//                         path diverges (different step>=N+1 result). Both
//                         trajectories independently inspectable from the journal.
//   2. multi-level-fork   fork of a fork of a fork: lineage chain correct, and
//                         NO ancestor effect re-fires across any level.
//   3. concurrent-forks   K forks off the SAME parent invoked concurrently: no
//                         journal corruption, no effect cross-contamination, each
//                         fork has its own divergent answer.
//   4. crash-during-fork  fork from BEFORE the side-effecting step so the fork
//                         fires a NEW effect; SIGKILL at the dangerous
//                         after-effect window of the FORKED run; on recovery the
//                         forked trajectory shows EXACTLY-ONCE. Plus a fork from
//                         AFTER the side effect, crashed mid-divergence, proving
//                         the SEEDED effect still never re-fires.
//
// Every assertion reads the REAL SQLite effect sink + journal. No happy path only.
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
import { countEffects, effectsFor, resetEffects } from "../effect-sink.js";
import { resetJournal, trajectory } from "../journal.js";
import { seedFork, validateForkPlan, ForkError, type ForkPlan } from "../fork.js";
import { diffTrajectories, inspectRun, lineage } from "../inspect.js";

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

function isProcAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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

function invokeAsync(runId: string, prompt: string, traj = "main"): void {
  void fetch(`${INGRESS}/AgentRun/${runId}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, trajectory: traj }),
  }).catch(() => {});
}

async function waitForCompletion(runId: string, timeoutMs = 40000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${INGRESS}/restate/workflow/AgentRun/${runId}/attach`);
      if (res.ok) return res.json();
    } catch {
      /* mid-restart */
    }
    await sleep(500);
  }
  throw new Error(`run ${runId} did not complete within ${timeoutMs}ms`);
}

async function startAndRegister(env: Record<string, string>): Promise<ServiceHandle> {
  const svc = startService(env);
  if (!(await waitForService(15000))) throw new Error("service did not come up");
  const reg = registerDeployment();
  if (!reg.ok) throw new Error("register failed: " + reg.out);
  return svc;
}

// ── Gate 1: fork from step N, no re-fire of seeded effects, divergence ────────
async function forkNoRefireGate(): Promise<void> {
  const svc = await startAndRegister({});
  try {
    const source = `m2-src-${Date.now()}`;
    const srcResult = await invokeSync(source, "original-prompt", "main");
    const srcEffectsBefore = countEffects(source, "step2-tool_call");

    // Fork from seq 2 (AFTER the side-effecting tool call): the effect is in the
    // seeded prefix, so it must NOT re-fire on the fork.
    const forked = `m2-fork-${Date.now()}`;
    const seeded = seedFork({
      sourceRunId: source,
      newRunId: forked,
      throughSeq: 2,
      decision: { prompt: "what-if-prompt", trajectory: "what-if" },
    });
    const forkResult = await invokeSync(forked, "what-if-prompt", "what-if");

    const srcEffectsAfter = countEffects(source, "step2-tool_call");
    const forkNewEffects = countEffects(forked, "step2-tool_call");

    // Independent inspection of BOTH trajectories from the journal alone.
    const insSrc = inspectRun(source);
    const insFork = inspectRun(forked);
    const diff = diffTrajectories(source, forked);

    const seededOk = seeded === 2;
    const noRefire =
      srcEffectsBefore === 1 && srcEffectsAfter === 1 && forkNewEffects === 0;
    const bothInspectable =
      insSrc.steps.length === 3 &&
      insFork.steps.length === 3 &&
      insFork.divergedAtSeq === 2 &&
      insFork.seededSeqs.join(",") === "1,2" &&
      insSrc.divergedAtSeq === null;
    const diverged = srcResult.answer !== forkResult.answer;
    // Shared prefix (seq 1,2) identical; divergence first at seq 3.
    const divergencePointOk =
      diff.firstDivergenceSeq === 3 &&
      diff.steps.find((s) => s.seq === 2)?.status === "same";
    const lineageOk =
      JSON.stringify(lineage(forked).map((n) => n.runId)) ===
      JSON.stringify([source, forked]);

    const pass =
      seededOk && noRefire && bothInspectable && diverged && divergencePointOk && lineageOk;
    record(
      "fork-no-refire",
      pass,
      `seeded=${seeded}(expect 2) src_effects=${srcEffectsAfter}(expect 1) ` +
        `fork_NEW_effects=${forkNewEffects}(expect 0) diverged_answer=${diverged} ` +
        `first_divergence_seq=${diff.firstDivergenceSeq}(expect 3) ` +
        `fork_seededSeqs=[${insFork.seededSeqs.join(",")}](expect 1,2) ` +
        `lineage_ok=${lineageOk} ` +
        `src_answer=${JSON.stringify(srcResult.answer)} fork_answer=${JSON.stringify(forkResult.answer)}`,
    );
  } finally {
    killProc(svc.proc);
    await sleep(200);
  }
}

// ── Gate 2: multi-level fork (fork of a fork of a fork) ───────────────────────
async function multiLevelForkGate(): Promise<void> {
  const svc = await startAndRegister({});
  try {
    const root = `m2-ml-root-${Date.now()}`;
    await invokeSync(root, "root-prompt", "root");
    const rootEffectsBefore = countEffects(root, "step2-tool_call");

    // L1 forks root from seq 2 (effect seeded). L2 forks L1 from seq 2. L3 forks
    // L2 from seq 2. At every level the side-effecting step is in the seeded
    // prefix, so NO level may fire a new step2 effect.
    const l1 = `m2-ml-l1-${Date.now()}`;
    seedFork({ sourceRunId: root, newRunId: l1, throughSeq: 2, decision: { prompt: "l1", trajectory: "l1" } });
    const l1Res = await invokeSync(l1, "l1", "l1");

    const l2 = `m2-ml-l2-${Date.now()}`;
    seedFork({ sourceRunId: l1, newRunId: l2, throughSeq: 2, decision: { prompt: "l2", trajectory: "l2" } });
    const l2Res = await invokeSync(l2, "l2", "l2");

    const l3 = `m2-ml-l3-${Date.now()}`;
    seedFork({ sourceRunId: l2, newRunId: l3, throughSeq: 2, decision: { prompt: "l3", trajectory: "l3" } });
    const l3Res = await invokeSync(l3, "l3", "l3");

    const rootEffectsAfter = countEffects(root, "step2-tool_call");
    const e1 = countEffects(l1, "step2-tool_call");
    const e2 = countEffects(l2, "step2-tool_call");
    const e3 = countEffects(l3, "step2-tool_call");

    // Lineage chain of the deepest fork must be root->l1->l2->l3.
    const chain = lineage(l3).map((n) => n.runId);
    const chainOk = JSON.stringify(chain) === JSON.stringify([root, l1, l2, l3]);

    // All three forks diverge from each other and from root at seq 3.
    const answers = new Set([l1Res.answer, l2Res.answer, l3Res.answer]);
    const allDiverged = answers.size === 3;

    // The seeded step2 output is byte-identical all the way down (ancestor reuse).
    const s2 = (rid: string) =>
      JSON.stringify(trajectory(rid).find((e) => e.seq === 2)?.output);
    const seededIdentical = s2(root) === s2(l1) && s2(l1) === s2(l2) && s2(l2) === s2(l3);

    const noAncestorRefire =
      rootEffectsBefore === 1 &&
      rootEffectsAfter === 1 &&
      e1 === 0 &&
      e2 === 0 &&
      e3 === 0;

    const pass = chainOk && allDiverged && seededIdentical && noAncestorRefire;
    record(
      "multi-level-fork",
      pass,
      `lineage=${chain.join("->")} (expect ${root}->l1->l2->l3 shape) chain_ok=${chainOk} ` +
        `effects[root=${rootEffectsAfter},l1=${e1},l2=${e2},l3=${e3}] (expect 1,0,0,0) ` +
        `distinct_answers=${answers.size}(expect 3) seeded_step2_identical_all_levels=${seededIdentical}`,
    );
  } finally {
    killProc(svc.proc);
    await sleep(200);
  }
}

// ── Gate 3: concurrent forks off the same parent ──────────────────────────────
async function concurrentForksGate(): Promise<void> {
  const svc = await startAndRegister({});
  try {
    const parent = `m2-cc-parent-${Date.now()}`;
    await invokeSync(parent, "parent-prompt", "parent");
    const parentEffectsBefore = countEffects(parent, "step2-tool_call");

    const K = 6;
    const forkIds = Array.from({ length: K }, (_, i) => `m2-cc-fork-${i}-${Date.now()}`);

    // Seed all forks from seq 2 (sequential seed; seeding is a fast journal txn),
    // then invoke ALL of them concurrently — the cross-contamination test.
    for (let i = 0; i < K; i++) {
      seedFork({
        sourceRunId: parent,
        newRunId: forkIds[i]!,
        throughSeq: 2,
        decision: { prompt: `cc-${i}`, trajectory: `cc-${i}` },
      });
    }
    const settled = await Promise.all(
      forkIds.map((id, i) =>
        invokeSync(id, `cc-${i}`, `cc-${i}`).catch((e) => ({ error: String(e) })),
      ),
    );

    const parentEffectsAfter = countEffects(parent, "step2-tool_call");
    const perForkNewEffects = forkIds.map((id) => countEffects(id, "step2-tool_call"));
    // Each fork's journal is exactly 3 steps, uncorrupted.
    const allThreeSteps = forkIds.every((id) => trajectory(id).length === 3);
    // No fork fired a new step2 effect (all seeded from seq 2).
    const noNewEffects = perForkNewEffects.every((c) => c === 0);
    // Distinct divergent answers — no cross-contamination of outputs.
    const answers = new Set(settled.filter((s: any) => s?.answer).map((s: any) => s.answer));
    const allDistinct = answers.size === K;
    // The parent's single effect is untouched.
    const parentIntact = parentEffectsBefore === 1 && parentEffectsAfter === 1;
    // Effect sink rows: only the parent's one step2 effect exists across the family.
    const familyStep2Effects =
      countEffects(parent, "step2-tool_call") +
      perForkNewEffects.reduce((a, b) => a + b, 0);

    const pass =
      allThreeSteps && noNewEffects && allDistinct && parentIntact && familyStep2Effects === 1;
    record(
      "concurrent-forks",
      pass,
      `forks=${K} parent_effects=${parentEffectsAfter}(expect 1) ` +
        `per_fork_NEW_effects=[${perForkNewEffects.join(",")}](expect all 0) ` +
        `distinct_answers=${answers.size}(expect ${K}) all_journals_3steps=${allThreeSteps} ` +
        `family_total_step2_effects=${familyStep2Effects}(expect 1)`,
    );
  } finally {
    killProc(svc.proc);
    await sleep(200);
  }
}

// ── Gate 4a: crash during a fork that fires a NEW effect → exactly-once ────────
// Fork from seq 1 (BEFORE the side-effecting step2). The forked run executes
// step2 itself, firing a NEW effect. SIGKILL at the dangerous after-effect window
// of the FORKED run; on recovery the forked trajectory must be exactly-once.
async function crashDuringForkNewEffectGate(): Promise<void> {
  // Source produced cleanly (no crash config) in a first service.
  let svc = await startAndRegister({});
  const source = `m2-cdf-src-${Date.now()}`;
  await invokeSync(source, "src", "main");
  const srcEffects = countEffects(source, "step2-tool_call");
  killProc(svc.proc);
  await sleep(300);

  const forked = `m2-cdf-fork-${Date.now()}`;
  // Seed only seq 1 — step2 (the effect) is NOT seeded; the fork will fire it.
  const seeded = seedFork({
    sourceRunId: source,
    newRunId: forked,
    throughSeq: 1,
    decision: { prompt: "diverge", trajectory: "crash-fork" },
  });

  const point = "after-effect:step2"; // the dangerous dual-write window
  // Phase 1: service SIGKILLs itself once at the after-effect window of the fork.
  svc = await startAndRegister({ DURABL_CRASH_AT: point, DURABL_CRASH_ONCE: "1" });
  invokeAsync(forked, "diverge", "crash-fork");

  const killDeadline = Date.now() + 15000;
  while (isProcAlive(svc.pid) && Date.now() < killDeadline) await sleep(150);
  const died = !isProcAlive(svc.pid);

  // Phase 2: restart; CRASH_ONCE marker persists; recover the forked run.
  killProc(svc.proc);
  await sleep(300);
  svc = await startAndRegister({ DURABL_CRASH_AT: point, DURABL_CRASH_ONCE: "1" });
  const result = await waitForCompletion(forked, 30000);

  const forkEffects = countEffects(forked, "step2-tool_call");
  const srcEffectsAfter = countEffects(source, "step2-tool_call");
  const steps = trajectory(forked).map((e) => e.stepName);
  const completed =
    steps.includes("step1-plan") &&
    steps.includes("step2-tool_call") &&
    steps.includes("step3-summarize");
  // seq1 was seeded; seq2 fired fresh on the fork exactly once even across crash.
  const seq1Seeded = trajectory(forked).find((e) => e.seq === 1)?.seededFrom === source;

  const pass =
    seeded === 1 &&
    died &&
    forkEffects === 1 &&
    srcEffectsAfter === srcEffects &&
    completed &&
    seq1Seeded === true;
  record(
    "crash-during-fork(new-effect)",
    pass,
    `seeded=${seeded}(expect 1) service_really_died=${died} ` +
      `forked_effect_fires=${forkEffects}(expect 1 exactly-once) ` +
      `source_effects_unchanged=${srcEffectsAfter}(expect ${srcEffects}) ` +
      `seq1_seeded_from_source=${seq1Seeded} journal_steps=[${steps.join(",")}] ` +
      `result=${JSON.stringify(result?.answer ?? result)}`,
  );

  killProc(svc.proc);
  await sleep(200);
}

// ── Gate 4b: crash during a fork whose effect was SEEDED → never re-fires ──────
// Fork from seq 2 (effect seeded). Crash the forked run mid-divergence (before
// step3). On recovery the SEEDED effect must NOT have re-fired.
async function crashDuringForkSeededGate(): Promise<void> {
  let svc = await startAndRegister({});
  const source = `m2-cdfs-src-${Date.now()}`;
  await invokeSync(source, "src", "main");
  const srcEffects = countEffects(source, "step2-tool_call");
  killProc(svc.proc);
  await sleep(300);

  const forked = `m2-cdfs-fork-${Date.now()}`;
  const seeded = seedFork({
    sourceRunId: source,
    newRunId: forked,
    throughSeq: 2,
    decision: { prompt: "diverge", trajectory: "crash-seeded" },
  });

  const point = "before:step3"; // crash AFTER seeded prefix, during divergence
  svc = await startAndRegister({ DURABL_CRASH_AT: point, DURABL_CRASH_ONCE: "1" });
  invokeAsync(forked, "diverge", "crash-seeded");

  const killDeadline = Date.now() + 15000;
  while (isProcAlive(svc.pid) && Date.now() < killDeadline) await sleep(150);
  const died = !isProcAlive(svc.pid);

  killProc(svc.proc);
  await sleep(300);
  svc = await startAndRegister({ DURABL_CRASH_AT: point, DURABL_CRASH_ONCE: "1" });
  const result = await waitForCompletion(forked, 30000);

  const forkNewEffects = countEffects(forked, "step2-tool_call");
  const srcEffectsAfter = countEffects(source, "step2-tool_call");
  const steps = trajectory(forked).map((e) => e.stepName);
  const completed = steps.length === 3;

  const pass =
    seeded === 2 &&
    died &&
    forkNewEffects === 0 &&
    srcEffectsAfter === srcEffects &&
    completed;
  record(
    "crash-during-fork(seeded-no-refire)",
    pass,
    `seeded=${seeded}(expect 2) service_really_died=${died} ` +
      `fork_NEW_effects=${forkNewEffects}(expect 0 even across crash) ` +
      `source_effects_unchanged=${srcEffectsAfter}(expect ${srcEffects}) ` +
      `journal_steps=[${steps.join(",")}] result=${JSON.stringify(result?.answer ?? result)}`,
  );

  killProc(svc.proc);
  await sleep(200);
}

// ── Gate 5: fork validation rejects bad plans (read-only, no substrate) ───────
async function forkValidationGate(): Promise<void> {
  const svc = await startAndRegister({});
  try {
    const source = `m2-val-src-${Date.now()}`;
    await invokeSync(source, "v", "main");

    const cases: Array<{ name: string; plan: ForkPlan }> = [
      {
        name: "unknown-source",
        plan: { sourceRunId: "does-not-exist", newRunId: "x1", throughSeq: 1, decision: { prompt: "p", trajectory: "t" } },
      },
      {
        name: "out-of-range-seq",
        plan: { sourceRunId: source, newRunId: "x2", throughSeq: 99, decision: { prompt: "p", trajectory: "t" } },
      },
      {
        name: "self-fork",
        plan: { sourceRunId: source, newRunId: source, throughSeq: 1, decision: { prompt: "p", trajectory: "t" } },
      },
      {
        name: "collision-target",
        plan: { sourceRunId: source, newRunId: source, throughSeq: 1, decision: { prompt: "p", trajectory: "t" } },
      },
    ];

    let allRejected = true;
    const detail: string[] = [];
    for (const c of cases) {
      let rejected = false;
      try {
        validateForkPlan(c.plan);
      } catch (e) {
        rejected = e instanceof ForkError;
      }
      allRejected = allRejected && rejected;
      detail.push(`${c.name}=${rejected ? "rejected" : "ACCEPTED!"}`);
    }
    // A valid plan must still pass validation.
    let validOk = false;
    try {
      validateForkPlan({ sourceRunId: source, newRunId: `m2-val-ok-${Date.now()}`, throughSeq: 2, decision: { prompt: "p", trajectory: "t" } });
      validOk = true;
    } catch {
      validOk = false;
    }

    const pass = allRejected && validOk;
    record(
      "fork-validation",
      pass,
      `${detail.join(" ")} valid_plan_accepted=${validOk}`,
    );
  } finally {
    killProc(svc.proc);
    await sleep(200);
  }
}

async function main(): Promise<void> {
  const only = process.argv[2];

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
    if (!only || only === "norefire") await forkNoRefireGate();
    if (!only || only === "multilevel") await multiLevelForkGate();
    if (!only || only === "concurrent") await concurrentForksGate();
    if (!only || only === "crashnew") await crashDuringForkNewEffectGate();
    if (!only || only === "crashseeded") await crashDuringForkSeededGate();
    if (!only || only === "validation") await forkValidationGate();
  } finally {
    killProc(server);
    spawnSync("pkill", ["-9", "-f", "restate-server"]);
    spawnSync("pkill", ["-9", "-f", "dist/service.js"]);
  }

  const passed = results.filter((r) => r.pass).length;
  const total = results.length;
  console.log(`\n================ M2 GATE SUMMARY ================`);
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
  console.log(`-------------------------------------------------`);
  console.log(`${passed}/${total} gates passed`);
  console.log(`VERDICT: ${passed === total ? "GATE PASSED" : "GATE FAILED"}`);
  console.log(`=================================================`);

  process.exitCode = passed === total ? 0 : 1;
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exitCode = 3;
});
