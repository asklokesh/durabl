#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// durabl CLI — fork ergonomics + read-only trajectory inspection (M2).
//
//   durabl run <runId> --prompt <p> [--trajectory <t>]
//   durabl fork <sourceRunId> --at <N> --new <newRunId> --prompt <p> [--trajectory <t>]
//   durabl inspect <runId>
//   durabl list-forks <runId>
//   durabl tree <runId>
//   durabl diff <runA> <runB>
//   durabl export <runId> [--meta]            (portable JSONL; --meta = include lineage)
//   durabl runs                               (list all known runs)
//
// Reads are pure journal queries (no substrate). `run`/`fork` invoke the
// substrate via the Restate ingress (config.restateIngress). All config (ingress,
// db paths) comes from env vars — nothing hardcoded, no secrets logged.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { config } from "./config.js";
import { exportJsonl, exportBundleJsonl, allRunIds } from "./journal.js";
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
import { startServer } from "./server.js";

const INGRESS = config.restateIngress;

/** Invoke a run on the Restate substrate via the ingress (synchronous attach). */
async function ingressInvoke(runId: string, decision: ForkDecision): Promise<unknown> {
  const res = await fetch(`${INGRESS}/AgentRun/${runId}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: decision.prompt, trajectory: decision.trajectory }),
  });
  if (!res.ok) {
    throw new Error(`invoke ${runId} -> ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string | boolean> } {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
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

/**
 * Pick the journal source for a read command. With `--from <file>`, the run is
 * reconstructed PURELY from a portable JSONL export (no SQLite, no substrate) —
 * the offline-portability path. Otherwise the live SQLite journal is used.
 */
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

const USAGE = `durabl — trajectory branching + replay/time-travel CLI (M2 + M3)

  durabl run <runId> --prompt <p> [--trajectory <t>]
  durabl fork <sourceRunId> --at <N> --new <newRunId> --prompt <p> [--trajectory <t>]
  durabl inspect <runId>
  durabl list-forks <runId>
  durabl tree <runId>
  durabl diff <runA> <runB>
  durabl export <runId> [--meta]
  durabl export-bundle <rootRunId>          (run + all forks + effects, portable)
  durabl runs

  M3 — observability / replay / time-travel (read-only, journal/export only):
  durabl replay <runId> [--from <export.jsonl>]   (reconstruct a run, step-by-step)
  durabl state-at <runId> --n <N> [--from <export.jsonl>]  (time-travel to step N)
  durabl ui [--port <p>] [--from <export.jsonl>]  (launch local replay web UI)
`;

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseFlags(rest);

  switch (cmd) {
    case "run": {
      const runId = positional[0];
      const prompt = flags.prompt;
      if (!runId || typeof prompt !== "string") {
        throw new Error("usage: durabl run <runId> --prompt <p> [--trajectory <t>]");
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
        throw new Error(
          "usage: durabl fork <sourceRunId> --at <N> --new <newRunId> --prompt <p> [--trajectory <t>]",
        );
      }
      const throughSeq = Number(at);
      if (!Number.isInteger(throughSeq)) throw new Error(`--at must be an integer (got ${at})`);
      const trajectory =
        typeof flags.trajectory === "string" ? flags.trajectory : `fork-of-${sourceRunId}`;
      const result = await forkAndRun(
        { sourceRunId, newRunId, throughSeq, decision: { prompt, trajectory } },
        ingressInvoke,
      );
      out(result);
      break;
    }
    case "inspect": {
      const runId = positional[0];
      if (!runId) throw new Error("usage: durabl inspect <runId>");
      out({ ...inspectRun(runId), lineage: lineage(runId) });
      break;
    }
    case "list-forks": {
      const runId = positional[0];
      if (!runId) throw new Error("usage: durabl list-forks <runId>");
      out(listForks(runId));
      break;
    }
    case "tree": {
      const runId = positional[0];
      if (!runId) throw new Error("usage: durabl tree <runId>");
      printTree(forkTree(runId));
      break;
    }
    case "diff": {
      const a = positional[0];
      const b = positional[1];
      if (!a || !b) throw new Error("usage: durabl diff <runA> <runB>");
      out(diffTrajectories(a, b));
      break;
    }
    case "export": {
      const runId = positional[0];
      if (!runId) throw new Error("usage: durabl export <runId> [--meta]");
      console.log(exportJsonl(runId, flags.meta === true));
      break;
    }
    case "export-bundle": {
      const runId = positional[0];
      if (!runId) throw new Error("usage: durabl export-bundle <rootRunId>");
      console.log(exportBundleJsonl(runId));
      break;
    }
    case "replay": {
      const runId = positional[0];
      if (!runId) throw new Error("usage: durabl replay <runId> [--from <export.jsonl>]");
      const source = sourceFromFlags(flags);
      const r = reconstruct(source, runId);
      console.log(`# replay of ${runId} reconstructed from: ${r.reconstructedFrom}`);
      console.log(`# trajectory=${r.trajectory} steps=${r.steps.length} effects=${r.effects.length} totalElapsedMs=${r.totalElapsedMs}`);
      for (const s of r.steps) {
        const tag = s.seeded ? " (seeded)" : "";
        const eff = s.effects.length ? ` [effects: ${s.effects.length}]` : "";
        const dt = s.elapsedMsFromPrev === null ? "" : ` +${s.elapsedMsFromPrev}ms`;
        console.log(`  seq ${s.seq} ${s.stepName} [${s.kind}]${s.sideEffect ? " (side-effect)" : ""}${tag}${dt}${eff}`);
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
        throw new Error("usage: durabl state-at <runId> --n <N> [--from <export.jsonl>]");
      }
      const n = Number(nFlag);
      if (!Number.isInteger(n)) throw new Error(`--n must be an integer (got ${nFlag})`);
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
      const host = await startServer({ port, importPath });
      console.log(`durabl replay UI running at ${host}`);
      console.log(`source: ${importPath ? `imported export ${importPath} (OFFLINE — no substrate)` : "live SQLite journal"}`);
      console.log(`(bound to localhost only; Ctrl-C to stop)`);
      // keep the process alive
      await new Promise(() => {});
      break;
    }
    case "runs": {
      out(allRunIds());
      break;
    }
    case "help":
    case undefined:
      console.log(USAGE);
      break;
    default:
      console.error(`unknown command: ${cmd}\n\n${USAGE}`);
      process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error("ERROR:", e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
