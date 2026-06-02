#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// durabl CLI — fork ergonomics + read-only trajectory inspection (M2+).
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config, validateConfig, ConfigError } from "./config.js";
import {
  exportJsonl,
  exportBundleJsonl,
  allRunIds,
  hitlState,
  pausedRuns,
} from "./journal.js";
import {
  diffTrajectories,
  forkTree,
  inspectRun,
  lineage,
  listForks,
  type ForkTreeNode,
} from "./inspect.js";
import { forkAndRun, type ForkDecision } from "./fork.js";
import {
  liveJournalSource,
  importJournalSource,
  type JournalSource,
} from "./journal-source.js";
import { reconstruct, stateAt } from "./replay.js";
import { startServerHandle } from "./server.js";
import { installSignalHandlers, registerGracefulShutdown } from "./lifecycle.js";
import { ingressFetch } from "./restate-ingress.js";
import { cliStyle, failCli, failRuntime, withSpinner } from "./cli-ui.js";

const PKG = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8"),
) as { version: string };
const VERSION = PKG.version;

const INGRESS = config.restateIngress;
const HARNESS_LOCK =
  process.env.DURABL_HARNESS_LOCK ?? join(tmpdir(), "durabl-harness.lock");
const CLI_CTX = { restateIngress: INGRESS, harnessLockPath: HARNESS_LOCK };

function cliError(message: string, code = 2): never {
  failCli(message, { code });
}

function usageError(usage: string): never {
  failCli(usage, {
    hints: [`Run ${cliStyle.info("durabl --help")} for the full command list.`],
  });
}

/** Invoke a run on the Restate substrate via the ingress (synchronous attach). */
async function ingressInvoke(runId: string, decision: ForkDecision): Promise<unknown> {
  return withSpinner(`invoking ${runId} via Restate`, async () => {
    const res = await ingressFetch(`${INGRESS}/AgentRun/${runId}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: decision.prompt, trajectory: decision.trajectory }),
    });
    if (!res.ok) {
      throw new Error(`invoke ${runId} failed (${res.status}): ${await res.text()}`);
    }
    return res.json();
  });
}

async function hitlSubmit(runId: string, prompt: string, traj: string): Promise<void> {
  return withSpinner(`submitting HITL run ${runId}`, async () => {
  const res = await ingressFetch(`${INGRESS}/HitlAgentRun/${runId}/run/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, trajectory: traj }),
  });
  if (!res.ok) {
    throw new Error(`hitl submit ${runId} failed (${res.status}): ${await res.text()}`);
  }
  });
}

async function hitlProvideInput(
  runId: string,
  decision: string,
): Promise<{ runId: string; accepted: boolean }> {
  return withSpinner(`resuming HITL run ${runId}`, async () => {
    const res = await ingressFetch(`${INGRESS}/HitlAgentRun/${runId}/provideInput`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    if (!res.ok) {
      throw new Error(`hitl provideInput ${runId} failed (${res.status}): ${await res.text()}`);
    }
    return res.json() as Promise<{ runId: string; accepted: boolean }>;
  });
}

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string | boolean> } {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "-h" || a === "--help") {
      flags.help = true;
      continue;
    }
    if (a === "-V" || a === "--version") {
      flags.version = true;
      continue;
    }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function out(obj: unknown): void {
  console.log(JSON.stringify(obj, null, 2));
}

function sourceFromFlags(flags: Record<string, string | boolean>): JournalSource {
  if (typeof flags.from === "string") {
    const jsonl = readFileSync(flags.from, "utf8");
    return importJournalSource(jsonl, `imported:${flags.from}`);
  }
  return liveJournalSource();
}

function printTree(node: ForkTreeNode, depth = 0): void {
  const indent = "  ".repeat(depth);
  const at = node.forkedAtSeq === null ? "root" : `fork@seq${node.forkedAtSeq}`;
  console.log(`${indent}- ${node.runId} [${node.trajectory}] (${at})`);
  for (const c of node.children) printTree(c, depth + 1);
}

const USAGE = `durabl ${VERSION} — portable agent journal (replay, fork, HITL)

Usage:
  durabl <command> [args] [flags]
  durabl --help
  durabl --version

Run & fork (requires Restate ingress; see DURABL_RESTATE_INGRESS):
  run <runId> --prompt <p> [--trajectory <t>]
  fork <sourceRunId> --at <N> --new <newRunId> --prompt <p> [--trajectory <t>]

Inspect (journal only; no substrate):
  inspect <runId>
  list-forks <runId>
  tree <runId>
  diff <runA> <runB>
  runs

Export:
  export <runId> [--meta]
  export-bundle <rootRunId>

Replay & UI (read-only; optional --from <export.jsonl> for offline):
  replay <runId> [--from <file>]
  state-at <runId> --n <N> [--from <file>]
  ui [--port <p>] [--from <file>]

Human-in-the-loop (Restate ingress):
  hitl-run <runId> --prompt <p> [--trajectory <t>]
  hitl-input <runId> --decision <text>
  hitl-status <runId>
  paused

Environment: DURABL_DATA_DIR, DURABL_JOURNAL_DB, DURABL_RESTATE_INGRESS, …
Docs: https://github.com/durabl/durabl/blob/main/docs/CLI.md
`;

const COMMAND_HELP: Record<string, string> = {
  run: `durabl run — invoke AgentRun on Restate ingress (sync attach)

Usage:
  durabl run <runId> --prompt <p> [--trajectory <t>]

Requires: DURABL_RESTATE_INGRESS`,

  fork: `durabl fork — seed journal through seq N and invoke a new run

Usage:
  durabl fork <sourceRunId> --at <N> --new <newRunId> --prompt <p> [--trajectory <t>]

Requires: DURABL_RESTATE_INGRESS`,

  inspect: `durabl inspect — trajectory, lineage, effects, forks (journal only)

Usage:
  durabl inspect <runId>`,

  "list-forks": `durabl list-forks — direct child forks of a run

Usage:
  durabl list-forks <runId>`,

  tree: `durabl tree — full descendant fork tree (stdout)

Usage:
  durabl tree <runId>`,

  diff: `durabl diff — per-seq divergence between two runs

Usage:
  durabl diff <runA> <runB>`,

  export: `durabl export — portable JSONL for one run

Usage:
  durabl export <runId> [--meta]

  --meta  Include lineage metadata line`,

  "export-bundle": `durabl export-bundle — JSONL bundle for a fork tree root

Usage:
  durabl export-bundle <rootRunId>`,

  replay: `durabl replay — human-readable step replay (journal only)

Usage:
  durabl replay <runId> [--from <export.jsonl>]

  --from  Offline replay from exported JSONL instead of live journal`,

  "state-at": `durabl state-at — time-travel state after step N

Usage:
  durabl state-at <runId> --n <N> [--from <export.jsonl>]`,

  ui: `durabl ui — replay web UI (localhost)

Usage:
  durabl ui [--port <p>] [--from <export.jsonl>]

  --port  HTTP port (default from config)
  --from  Offline mode from exported JSONL`,

  runs: `durabl runs — list all known run ids (journal only)

Usage:
  durabl runs`,

  "hitl-run": `durabl hitl-run — start HITL run (suspends at pause)

Usage:
  durabl hitl-run <runId> --prompt <p> [--trajectory <t>]

Requires: DURABL_RESTATE_INGRESS`,

  "hitl-input": `durabl hitl-input — resume paused HITL run with human decision

Usage:
  durabl hitl-input <runId> --decision <text>

Requires: DURABL_RESTATE_INGRESS`,

  "hitl-status": `durabl hitl-status — HITL state for a run (journal + ingress)

Usage:
  durabl hitl-status <runId>`,

  paused: `durabl paused — runs awaiting human input

Usage:
  durabl paused`,
};

function printCommandHelp(command: string): void {
  const text = COMMAND_HELP[command];
  if (text) {
    console.log(text);
    return;
  }
  console.log(USAGE);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv[0] === "help") {
    console.log(USAGE);
    return;
  }
  if (argv.length === 1 && (argv[0] === "-h" || argv[0] === "--help")) {
    console.log(USAGE);
    return;
  }
  const versionAt = argv.findIndex((a) => a === "-V" || a === "--version");
  if (versionAt !== -1) {
    const firstCmd = argv.find((a) => !a.startsWith("-"));
    const cmdAt = firstCmd === undefined ? -1 : argv.indexOf(firstCmd);
    if (cmdAt === -1 || versionAt < cmdAt) {
      console.log(VERSION);
      return;
    }
  }

  const [cmd, ...rest] = argv;
  if (cmd === "-h" || cmd === "--help") {
    console.log(USAGE);
    return;
  }
  const { positional, flags } = parseFlags(rest);

  if (flags.help) {
    printCommandHelp(cmd ?? "");
    return;
  }

  try {
    validateConfig();
  } catch (e) {
    if (e instanceof ConfigError) cliError(e.message);
    throw e;
  }

  switch (cmd) {
    case "run": {
      const runId = positional[0];
      const prompt = flags.prompt;
      if (!runId || typeof prompt !== "string") {
        cliError("usage: durabl run <runId> --prompt <p> [--trajectory <t>]");
      }
      const trajectory = typeof flags.trajectory === "string" ? flags.trajectory : "main";
      const result = await ingressInvoke(runId, { prompt, trajectory });
      out({ ran: runId, result });
      break;
    }
    case "fork": {
      const sourceRunId = positional[0];
      const newRunId = flags.new;
      const at = flags.at;
      const prompt = flags.prompt;
      if (
        !sourceRunId ||
        typeof newRunId !== "string" ||
        typeof at !== "string" ||
        typeof prompt !== "string"
      ) {
        cliError(
          "usage: durabl fork <sourceRunId> --at <N> --new <newRunId> --prompt <p> [--trajectory <t>]",
        );
      }
      const throughSeq = Number(at);
      if (!Number.isInteger(throughSeq)) cliError(`--at must be an integer (got ${at})`);
      const trajectory =
        typeof flags.trajectory === "string" ? flags.trajectory : `fork-of-${sourceRunId}`;
      const result = await withSpinner(`forking ${sourceRunId} → ${newRunId}`, () =>
        forkAndRun(
          { sourceRunId, newRunId, throughSeq, decision: { prompt, trajectory } },
          ingressInvoke,
        ),
      );
      out(result);
      break;
    }
    case "inspect": {
      const runId = positional[0];
      if (!runId) cliError("usage: durabl inspect <runId>");
      out({ ...inspectRun(runId), lineage: lineage(runId) });
      break;
    }
    case "list-forks": {
      const runId = positional[0];
      if (!runId) cliError("usage: durabl list-forks <runId>");
      out(listForks(runId));
      break;
    }
    case "tree": {
      const runId = positional[0];
      if (!runId) cliError("usage: durabl tree <runId>");
      printTree(forkTree(runId));
      break;
    }
    case "diff": {
      const a = positional[0];
      const b = positional[1];
      if (!a || !b) cliError("usage: durabl diff <runA> <runB>");
      out(diffTrajectories(a, b));
      break;
    }
    case "export": {
      const runId = positional[0];
      if (!runId) cliError("usage: durabl export <runId> [--meta]");
      console.log(exportJsonl(runId, flags.meta === true));
      break;
    }
    case "export-bundle": {
      const runId = positional[0];
      if (!runId) cliError("usage: durabl export-bundle <rootRunId>");
      console.log(exportBundleJsonl(runId));
      break;
    }
    case "replay": {
      const runId = positional[0];
      if (!runId) cliError("usage: durabl replay <runId> [--from <export.jsonl>]");
      const source = sourceFromFlags(flags);
      const r = reconstruct(source, runId);
      console.log(`# replay of ${runId} reconstructed from: ${r.reconstructedFrom}`);
      console.log(
        `# trajectory=${r.trajectory} steps=${r.steps.length} effects=${r.effects.length} totalElapsedMs=${r.totalElapsedMs}`,
      );
      for (const s of r.steps) {
        const tag = s.seeded ? " (seeded)" : "";
        const eff = s.effects.length ? ` [effects: ${s.effects.length}]` : "";
        const dt = s.elapsedMsFromPrev === null ? "" : ` +${s.elapsedMsFromPrev}ms`;
        console.log(
          `  seq ${s.seq} ${s.stepName} [${s.kind}]${s.sideEffect ? " (side-effect)" : ""}${tag}${dt}${eff}`,
        );
        console.log(`    output: ${JSON.stringify(s.output)}`);
      }
      if (r.divergencePoints.length) {
        console.log(`# divergence points (forks branched off this run):`);
        for (const d of r.divergencePoints) {
          console.log(`    seq ${d.seq} → fork ${d.forkRunId} [${d.forkTrajectory}]`);
        }
      }
      console.log(`# outcome: ${JSON.stringify(r.outcome)}`);
      break;
    }
    case "state-at": {
      const runId = positional[0];
      const nFlag = flags.n;
      if (!runId || typeof nFlag !== "string") {
        cliError("usage: durabl state-at <runId> --n <N> [--from <export.jsonl>]");
      }
      const n = Number(nFlag);
      if (!Number.isInteger(n)) cliError(`--n must be an integer (got ${nFlag})`);
      const source = sourceFromFlags(flags);
      const st = stateAt(source, runId, n);
      out({
        runId: st.runId,
        timeTravelledToStep: st.n,
        maxSeq: st.maxSeq,
        currentOutput: st.currentOutput,
        stepsSoFar: st.steps.map((s) => ({ seq: s.seq, stepName: s.stepName, output: s.output })),
        effectsSoFar: st.effects.length,
        divergedSoFar: st.divergedSoFar,
        reconstructedFrom: st.reconstructedFrom,
      });
      break;
    }
    case "ui": {
      const port = typeof flags.port === "string" ? Number(flags.port) : undefined;
      const importPath = typeof flags.from === "string" ? flags.from : undefined;
      const handle = await withSpinner("starting replay UI", () =>
        startServerHandle({ port, importPath }),
      );
      registerGracefulShutdown(() => handle.close());
      installSignalHandlers();
      console.log(`${cliStyle.info("durabl replay UI")} running at ${cliStyle.bold(handle.url)}`);
      console.log(
        cliStyle.dim(
          `source: ${importPath ? `imported export ${importPath} (OFFLINE — no substrate)` : "live SQLite journal"}`,
        ),
      );
      console.log(cliStyle.dim("(bound to localhost only; SIGTERM/SIGINT to stop)"));
      await new Promise(() => {});
      break;
    }
    case "runs": {
      out(allRunIds());
      break;
    }
    case "hitl-run": {
      const runId = positional[0];
      const prompt = flags.prompt;
      if (!runId || typeof prompt !== "string") {
        cliError("usage: durabl hitl-run <runId> --prompt <p> [--trajectory <t>]");
      }
      const trajectory = typeof flags.trajectory === "string" ? flags.trajectory : "main";
      await hitlSubmit(runId, prompt, trajectory);
      out({
        submitted: runId,
        state: hitlState(runId),
        note: "run is durably suspended at the HITL pause once it reaches it; supply input with `durabl hitl-input`",
      });
      break;
    }
    case "hitl-input": {
      const runId = positional[0];
      const decision = flags.decision;
      if (!runId || typeof decision !== "string") {
        cliError("usage: durabl hitl-input <runId> --decision <text>");
      }
      const res = await hitlProvideInput(runId, decision);
      out(res);
      break;
    }
    case "hitl-status": {
      const runId = positional[0];
      if (!runId) cliError("usage: durabl hitl-status <runId>");
      out({ runId, state: hitlState(runId) });
      break;
    }
    case "paused": {
      out(pausedRuns());
      break;
    }
    case "help":
    case undefined:
      console.log(USAGE);
      break;
    default:
      cliError(`unknown command "${cmd}"\n\n${USAGE}`);
  }
}

main().catch((e) => {
  failRuntime(e, CLI_CTX);
});
