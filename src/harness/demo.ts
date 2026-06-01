// ─────────────────────────────────────────────────────────────────────────────
// THE SINGLE DEMO THAT PROVES THE COMPANY (M1 + M2 narrative), scripted end-to-end.
//
//   npm run demo
//
// Narrative, performed against a REAL restate-server with a REAL SIGKILL:
//   1. Start an agent run; KILL it mid-run (real SIGKILL at the dangerous
//      after-effect window).
//   2. It resumes from the exact step — the side effect did NOT double-fire
//      (exactly-once preserved). [M1]
//   3. Open the completed trajectory and inspect it from the portable journal.
//   4. FORK from an earlier step (before the tool call) onto an alternate path
//      with a new decision — exploring "what if I'd decided differently at step N".
//   5. Show both trajectories side-by-side (diff) and the fork lineage, and prove
//      the forked path fired its own effect exactly once while the original's
//      effect was never touched. [M2]
//
// This is illustrative (clear console narration), but it is NOT a mock: every
// number printed is read from the real effect sink + journal, and the crash is a
// real uncatchable SIGKILL recovered by the substrate.
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
import { resetJournal, trajectory, exportJsonl } from "../journal.js";
import { seedFork } from "../fork.js";
import { diffTrajectories, inspectRun, lineage } from "../inspect.js";

const INGRESS = config.restateIngress;

function say(s: string): void {
  console.log(s);
}
function h(title: string): void {
  console.log(`\n${"━".repeat(74)}\n${title}\n${"━".repeat(74)}`);
}

function isProcAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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

async function main(): Promise<void> {
  spawnSync("pkill", ["-9", "-f", "restate-server"]);
  spawnSync("pkill", ["-9", "-f", "dist/service.js"]);
  await sleep(1500);
  rmSync(config.restateDataDir, { recursive: true, force: true });
  resetEffects();
  resetJournal();
  spawnSync("rm", ["-rf", process.env.DURABL_CRASH_MARKER_DIR ?? "/tmp/durabl-m1/markers"]);

  const server = startRestateServer();
  if (!(await waitForRestate(60000))) {
    killProc(server);
    throw new Error("restate-server failed to become healthy");
  }

  let ok = true;
  try {
    const runId = `demo-${Date.now()}`;
    const point = "after-effect:step2";

    h("ACT 1 — Kill an agent mid-run. It must NOT double-fire its side effect.");
    say(`Starting agent run ${runId}; it will be SIGKILLed at the dangerous`);
    say(`"effect fired, journal not yet committed" window (point=${point}).`);

    let svc = await startAndRegister({ DURABL_CRASH_AT: point, DURABL_CRASH_ONCE: "1" });
    invokeAsync(runId, "ship-the-invoice");
    const killDeadline = Date.now() + 15000;
    while (isProcAlive(svc.pid) && Date.now() < killDeadline) await sleep(150);
    const died = !isProcAlive(svc.pid);
    say(`  → service really died (uncatchable SIGKILL): ${died}`);

    h("ACT 2 — Resume from the exact step. Exactly-once preserved.");
    killProc(svc.proc);
    await sleep(300);
    svc = await startAndRegister({ DURABL_CRASH_AT: point, DURABL_CRASH_ONCE: "1" });
    const recovered = await waitForCompletion(runId, 30000);
    const effects = countEffects(runId, "step2-tool_call");
    say(`  → run recovered and completed: ${JSON.stringify(recovered.answer)}`);
    say(`  → side-effect fire count (read from REAL effect sink): ${effects} (expect 1)`);
    const act2Ok = effects === 1 && trajectory(runId).length === 3;
    say(`  → EXACTLY-ONCE across crash: ${act2Ok ? "YES ✓" : "NO ✗"}`);
    ok = ok && died && act2Ok;

    h("ACT 3 — Open the trajectory from the portable journal.");
    const ins = inspectRun(runId);
    for (const s of ins.steps) {
      say(`  seq ${s.seq} ${s.stepName} [${s.kind}]${s.sideEffect ? " (side-effect)" : ""} → ${JSON.stringify(s.output)}`);
    }
    say(`  effects fired by this run: ${ins.effects.length}`);

    h("ACT 4 — Fork from an earlier step onto an alternate path (new decision).");
    // Restart the service WITHOUT crash config: the fork should run cleanly. (The
    // crash-during-fork path is exercised exhaustively by the M2 gate, not here.)
    killProc(svc.proc);
    await sleep(300);
    svc = await startAndRegister({});
    const fork = `demo-fork-${Date.now()}`;
    say(`Forking ${runId} at seq 1 (BEFORE the tool call) → ${fork}`);
    say(`with a NEW decision/prompt. The forked path will make its OWN tool call.`);
    const seeded = seedFork({
      sourceRunId: runId,
      newRunId: fork,
      throughSeq: 1,
      decision: { prompt: " what-if-we-refund-instead", trajectory: "what-if" },
    });
    say(`  → seeded ${seeded} step(s) from the original (seq <= 1), no re-execution`);
    const forkRes = await invokeSync(fork, "what-if-we-refund-instead", "what-if");
    say(`  → forked run completed: ${JSON.stringify(forkRes.answer)}`);

    h("ACT 5 — Compare the two trajectories. Prove no cross-fire.");
    const origEffectsAfter = countEffects(runId, "step2-tool_call");
    const forkEffects = countEffects(fork, "step2-tool_call");
    say(`  original effect fires (unchanged by the fork): ${origEffectsAfter} (expect 1)`);
    say(`  forked path effect fires (its OWN new effect):  ${forkEffects} (expect 1)`);
    const diff = diffTrajectories(runId, fork);
    say(`  first divergence at seq: ${diff.firstDivergenceSeq}`);
    for (const s of diff.steps) {
      say(`    seq ${s.seq} ${s.stepName}: ${s.status}`);
    }
    say(`  lineage of fork: ${lineage(fork).map((n) => `${n.runId}[${n.trajectory}]`).join(" → ")}`);
    say(`\n  portable export of the fork (lineage travels with it):`);
    say(
      exportJsonl(fork, true)
        .split("\n")
        .map((l) => "    " + l)
        .join("\n"),
    );
    const act5Ok =
      origEffectsAfter === 1 && forkEffects === 1 && diff.firstDivergenceSeq !== null;
    ok = ok && act5Ok && seeded === 1;

    h("DEMO RESULT");
    say(`Crash → exact-step resume, no double-fire:       ${died && act2Ok ? "PASS" : "FAIL"}`);
    say(`Open trajectory, fork from earlier step, explore: ${act5Ok && seeded === 1 ? "PASS" : "FAIL"}`);
    say(`\nVERDICT: ${ok ? "DEMO PASSED — this is the single demo that proves the company." : "DEMO FAILED"}`);

    killProc(svc.proc);
  } finally {
    killProc(server);
    spawnSync("pkill", ["-9", "-f", "restate-server"]);
    spawnSync("pkill", ["-9", "-f", "dist/service.js"]);
  }

  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
  console.error("DEMO ERROR:", e);
  process.exitCode = 3;
});
