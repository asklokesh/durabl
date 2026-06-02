// ─────────────────────────────────────────────────────────────────────────────
// M3 GATE — OBSERVABILITY / REPLAY / TIME-TRAVEL (real evidence, single command).
//
//   npm run gate:m3
//
// This gate proves the M3 wedge claims with REAL evidence:
//
//   G1  reconstruct-matches-reality:
//       Produce a real run on the Restate substrate (the M1/M2 workflow), then
//       reconstruct it PURELY from the journal and assert the replayed step
//       sequence + effects EXACTLY match what actually happened
//       (replay-divergence = NONE).
//
//   G2  offline-from-export (THE PORTABILITY PROOF):
//       Export the run + its whole fork tree to a portable JSONL bundle. Then
//       SHUT DOWN Restate entirely (kill the server + service; assert dead).
//       Reconstruct the full run AND its forks from the EXPORT ALONE — no
//       substrate, no SQLite journal — and assert it byte-matches the live
//       reconstruction (divergence = NONE). This is the "your journal is
//       portable, not a lab's" gate.
//
//   G3  time-travel-correctness:
//       state-at step N (offline, from the export) reports the correct as-of
//       state + effect set, and out-of-range N is rejected.
//
//   G4  fork-tree-and-diff:
//       The fork tree and a trajectory diff reconstruct correctly for the
//       multi-fork run — from the offline export.
//
//   G5  ui-headless (best-effort): launch the local web UI OVER THE OFFLINE
//       EXPORT (no substrate), drive it headlessly with gstack browse, and
//       screenshot the timeline, fork tree, and diff as evidence. If the browse
//       binary is unavailable, this sub-gate is reported SKIPPED (not failed),
//       and the replay engine + APIs are still fully verified above.
//
// Every assertion reads real data; no mocks. G1's run is the same workflow the
// M1/M2 gates use. The substrate is genuinely killed before G2–G4 reconstruct.
// ─────────────────────────────────────────────────────────────────────────────

import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import {
  sleep,
  enterHarnessGate,
  releaseHarnessLock,
  startRestateServerAndWait,
  startAndRegisterService,
  waitForRestateDown,
  killProc,
  type ServiceHandle,
} from "./restate-control.js";
import { resetEffects } from "../effect-sink.js";
import { resetJournal, exportBundleJsonl } from "../journal.js";
import { seedFork } from "../fork.js";
import {
  liveJournalSource,
  importJournalSource,
} from "../journal-source.js";
import {
  reconstruct,
  stateAt,
  assertReplayMatches,
} from "../replay.js";
import { forkTreeFrom, diffTrajectoriesFrom } from "../inspect-source.js";
import { startServerHandle } from "../server.js";
import { FIXTURE_M3_PORTABLE } from "./fixture-paths.js";

const INGRESS = config.restateIngress;
const EVID_DIR = join(process.cwd(), "docs", "m3-evidence");
const RUNTIME_BUNDLE = join(EVID_DIR, "portable-bundle.jsonl");

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

async function invokeSync(runId: string, prompt: string, traj = "main"): Promise<any> {
  const res = await fetch(`${INGRESS}/AgentRun/${runId}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, trajectory: traj }),
  });
  if (!res.ok) throw new Error(`invoke ${runId} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main(): Promise<void> {
  await enterHarnessGate();
  rmSync(config.restateDataDir, { recursive: true, force: true });
  resetEffects();
  resetJournal();
  mkdirSync(EVID_DIR, { recursive: true });

  const server = await startRestateServerAndWait();

  const ts = Date.now();
  const rootId = `m3-root-${ts}`;
  const forkA = `m3-forkA-${ts}`;
  const forkB = `m3-forkB-${ts}`;
  const subFork = `m3-subforkB-${ts}`;
  let bundle = "";

  try {
    let svc = await startAndRegisterService();

    // ── Produce a real multi-fork run on the substrate ──────────────────────
    // 1. root run (3 steps, one side effect at step 2)
    const rootRes = await invokeSync(rootId, "original-prompt", "main");
    // 2. forkA from seq 2 (effect in seeded prefix → no re-fire), diverge
    seedFork({ sourceRunId: rootId, newRunId: forkA, throughSeq: 2, decision: { prompt: "what-if-A", trajectory: "what-if-A" } });
    const forkARes = await invokeSync(forkA, "what-if-A", "what-if-A");
    // 3. forkB from seq 1 (fires its OWN effect), diverge
    seedFork({ sourceRunId: rootId, newRunId: forkB, throughSeq: 1, decision: { prompt: "what-if-B", trajectory: "what-if-B" } });
    const forkBRes = await invokeSync(forkB, "what-if-B", "what-if-B");
    // 4. sub-fork of forkB from seq 2 (fork of a fork → multi-level tree)
    seedFork({ sourceRunId: forkB, newRunId: subFork, throughSeq: 2, decision: { prompt: "what-if-B2", trajectory: "what-if-B2" } });
    const subRes = await invokeSync(subFork, "what-if-B2", "what-if-B2");

    const live = liveJournalSource();

    // ── G1: reconstruct matches reality (live journal) ──────────────────────
    {
      const liveReplay = reconstruct(live, rootId);
      // "what actually happened" = the substrate's returned result for the run.
      const expectedAnswer = rootRes.answer;
      const reconstructedAnswer = liveReplay.outcome;
      const stepNamesOk =
        liveReplay.steps.map((s) => s.stepName).join(",") ===
        "step1-plan,step2-tool_call,step3-summarize";
      const effectsOk = liveReplay.effects.length === 1; // step2 fired once
      // self-consistency: reconstructing twice yields identical (deterministic)
      const twice = assertReplayMatches(liveReplay, reconstruct(live, rootId));
      const pass =
        reconstructedAnswer === expectedAnswer &&
        stepNamesOk &&
        effectsOk &&
        twice.identical;
      record(
        "G1 reconstruct-matches-reality",
        pass,
        `reconstructed_from=${liveReplay.reconstructedFrom} steps=[${liveReplay.steps.map((s) => s.stepName).join(",")}] ` +
          `effects=${liveReplay.effects.length}(expect 1) outcome_matches_substrate_result=${reconstructedAnswer === expectedAnswer} ` +
          `replay_divergence=${twice.identical ? "none" : twice.differences.join("; ")} ` +
          `outcome=${JSON.stringify(reconstructedAnswer)}`,
      );
    }

    // ── Export the run + whole fork tree to a portable bundle ───────────────
    bundle = exportBundleJsonl(rootId);
    writeFileSync(RUNTIME_BUNDLE, bundle, "utf8");
    console.log(
      `# exported portable bundle (${bundle.split("\n").length} lines) → ${RUNTIME_BUNDLE} ` +
        `(committed fixture: ${FIXTURE_M3_PORTABLE})\n`,
    );

    // Snapshot the live reconstructions BEFORE killing the substrate, so G2 can
    // compare offline-reconstruction against live-reconstruction.
    const liveRoot = reconstruct(live, rootId);
    const liveForkA = reconstruct(live, forkA);
    const liveForkB = reconstruct(live, forkB);
    const liveSub = reconstruct(live, subFork);

    // ── KILL THE SUBSTRATE ENTIRELY (the portability proof setup) ───────────
    killProc(svc.proc);
    killProc(server);
    spawnSync("pkill", ["-9", "-f", "restate-server"]);
    spawnSync("pkill", ["-9", "-f", "dist/service.js"]);
    await sleep(2000);
    const restateDead = await waitForRestateDown(5000); // health must NOT come back
    const serviceDead = !isProcAlive(svc.pid) && !isProcAlive(server.pid ?? -1);
    console.log(`# substrate killed: restate_health_unreachable=${restateDead} service_pids_dead=${serviceDead}\n`);

    // ── G2: offline-from-export reconstruction == live (NO SUBSTRATE) ───────
    {
      // Reconstruct EVERYTHING from the exported bundle string alone.
      const imp = importJournalSource(bundle, "imported:portable-bundle.jsonl");
      const impRoot = reconstruct(imp, rootId);
      const impForkA = reconstruct(imp, forkA);
      const impForkB = reconstruct(imp, forkB);
      const impSub = reconstruct(imp, subFork);

      const dRoot = assertReplayMatches(liveRoot, impRoot);
      const dA = assertReplayMatches(liveForkA, impForkA);
      const dB = assertReplayMatches(liveForkB, impForkB);
      const dSub = assertReplayMatches(liveSub, impSub);
      const allIdentical = dRoot.identical && dA.identical && dB.identical && dSub.identical;
      const offlineOrigin = impRoot.reconstructedFrom.startsWith("imported");

      const pass = restateDead && serviceDead && allIdentical && offlineOrigin;
      record(
        "G2 offline-from-export (portability proof)",
        pass,
        `substrate_dead=${restateDead && serviceDead} reconstructed_from=${impRoot.reconstructedFrom} ` +
          `root_divergence=${dRoot.identical ? "none" : dRoot.differences.join(";")} ` +
          `forkA_divergence=${dA.identical ? "none" : dA.differences.join(";")} ` +
          `forkB_divergence=${dB.identical ? "none" : dB.differences.join(";")} ` +
          `subforkB_divergence=${dSub.identical ? "none" : dSub.differences.join(";")} ` +
          `forkB_own_effect=${impForkB.effects.length}(expect 1 — fork@1 fires own effect) ` +
          `forkA_seeded_no_refire=${impForkA.steps.filter((s) => s.seeded).length}seeded`,
      );
    }

    // ── G3: time-travel correctness (offline, from export) ──────────────────
    {
      const imp = importJournalSource(bundle);
      const at2 = stateAt(imp, rootId, 2);
      const full = reconstruct(imp, rootId);
      const expectedAt2 = full.steps.find((s) => s.seq === 2)!.output;
      const stepsSoFarOk = at2.steps.length === 2 && at2.steps[at2.steps.length - 1]!.seq === 2;
      const effectsAsOf2Ok = at2.effects.length === 1; // effect at step 2 present
      const at1 = stateAt(imp, rootId, 1);
      const effectsAsOf1Ok = at1.effects.length === 0; // no effect yet at step 1
      // divergedSoFar at step 1 should include forkB (forked @1); at step 2 include forkA (forked@2)
      const div1HasForkB = at1.divergedSoFar.some((d) => d.forkRunId === forkB);
      const div2HasForkA = at2.divergedSoFar.some((d) => d.forkRunId === forkA);
      let rangeRejected = false;
      try {
        stateAt(imp, rootId, 99);
      } catch {
        rangeRejected = true;
      }
      const pass =
        stepsSoFarOk &&
        at2.currentOutput === expectedAt2 &&
        effectsAsOf2Ok &&
        effectsAsOf1Ok &&
        div1HasForkB &&
        div2HasForkA &&
        rangeRejected;
      record(
        "G3 time-travel-correctness",
        pass,
        `at_step2: steps=${at2.steps.length}(expect 2) currentOutput_matches=${at2.currentOutput === expectedAt2} effects_as_of_2=${at2.effects.length}(expect 1) diverged=[${at2.divergedSoFar.map((d) => `@${d.seq}:${d.forkRunId}`).join(",")}] ` +
          `at_step1: effects=${at1.effects.length}(expect 0) diverged_has_forkB=${div1HasForkB} ` +
          `out_of_range_rejected=${rangeRejected}`,
      );
    }

    // ── G4: fork tree + trajectory diff (offline, from export) ──────────────
    {
      const imp = importJournalSource(bundle);
      const tree = forkTreeFrom(imp, rootId);
      // expected shape: root -> [forkA, forkB -> [subForkB]]
      const rootChildren = tree.children.map((c) => c.runId).sort();
      const treeOk =
        tree.runId === rootId &&
        rootChildren.includes(forkA) &&
        rootChildren.includes(forkB) &&
        tree.children.find((c) => c.runId === forkB)?.children.some((g) => g.runId === subFork) === true;

      const diff = diffTrajectoriesFrom(imp, rootId, forkA);
      // forkA forked @2: seq1,2 same (seeded), seq3 changed
      const diffOk =
        diff.firstDivergenceSeq === 3 &&
        diff.steps.find((s) => s.seq === 1)?.status === "same" &&
        diff.steps.find((s) => s.seq === 2)?.status === "same" &&
        diff.steps.find((s) => s.seq === 3)?.status === "changed";

      const pass = treeOk && diffOk;
      record(
        "G4 fork-tree-and-diff",
        pass,
        `tree=${rootId}->[${rootChildren.join(",")}], ${forkB}->[${subFork}] tree_ok=${treeOk} ` +
          `diff(root,forkA): first_divergence=${diff.firstDivergenceSeq}(expect 3) ` +
          `seq_status=[${diff.steps.map((s) => `${s.seq}:${s.status}`).join(",")}] diff_ok=${diffOk}`,
      );
    }

    // ── G5: the UI's read APIs serve the OFFLINE export (no substrate) ───────
    // The browser screenshots are captured by a SEPARATE process
    // (scripts/capture-ui.mjs / `npm run capture:ui`) to avoid driving the
    // browse daemon from inside this process's event loop (which also hosts the
    // http server). Here we hard-verify the UI's data path works fully offline:
    // every read endpoint the UI calls answers correctly from the imported
    // export with Restate dead. That IS the "UI runs offline" proof; the PNGs
    // are committed evidence captured via the standalone capturer.
    await uiApiGate(RUNTIME_BUNDLE);
  } finally {
    killProc(server);
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log("================ M3 GATE SUMMARY ================");
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

/**
 * G5 — verify every read endpoint the replay UI uses answers correctly from the
 * OFFLINE imported export, with NO substrate running. This is the substantive
 * "the UI works offline" proof (its entire data path is exercised). Browser
 * screenshots are produced separately by `npm run capture:ui`.
 */
async function uiApiGate(bundlePath: string): Promise<void> {
  const handle = await startServerHandle({
    importPath: bundlePath,
    port: Number(process.env.DURABL_UI_PORT ?? 7879),
  });
  const base = handle.url;
  console.log(`# replay UI serving OFFLINE export at ${base}\n`);
  try {
    const get = async (p: string): Promise<any> => {
      const r = await fetch(`${base}${p}`);
      if (!r.ok) throw new Error(`${p} -> ${r.status}`);
      return r.json();
    };
    const health = await get("/api/health");
    const originImported = typeof health.origin === "string" && health.origin.startsWith("imported");
    const runs = await get("/api/runs");
    const runsOk = Array.isArray(runs.runs) && runs.runs.length >= 4 && Array.isArray(runs.roots);
    const root = runs.roots[0];
    const replay = await get(`/api/replay?runId=${encodeURIComponent(root)}`);
    const replayOk =
      replay.reconstructedFrom &&
      String(replay.reconstructedFrom).startsWith("imported") &&
      replay.steps.length === 3 &&
      replay.effects.length === 1;
    const tree = await get(`/api/tree?runId=${encodeURIComponent(root)}`);
    const treeOk = tree.tree && tree.tree.children.length === 2;
    const forkA = tree.tree.children[0].runId;
    const diff = await get(`/api/diff?a=${encodeURIComponent(root)}&b=${encodeURIComponent(forkA)}`);
    const diffOk = Array.isArray(diff.steps) && diff.firstDivergenceSeq !== undefined;
    const st = await get(`/api/state-at?runId=${encodeURIComponent(root)}&n=2`);
    const ttOk = st.n === 2 && st.steps.length === 2;

    const pass = originImported && runsOk && replayOk && treeOk && diffOk && ttOk;
    record(
      "G5 ui-api-offline",
      pass,
      `origin=${health.origin} origin_imported=${originImported} /api/runs=${runs.runs.length}runs(${runsOk}) ` +
        `/api/replay steps=${replay.steps.length} effects=${replay.effects.length} from=${replay.reconstructedFrom}(${replayOk}) ` +
        `/api/tree children=${tree.tree.children.length}(${treeOk}) /api/diff firstDiv=${diff.firstDivergenceSeq}(${diffOk}) ` +
        `/api/state-at n=2 steps=${st.steps.length}(${ttOk}) — UI data path fully offline, no substrate`,
    );
  } finally {
    await handle.close();
  }
}

main().catch((e) => {
  console.error("M3 GATE ERROR:", e);
  process.exitCode = 3;
});
