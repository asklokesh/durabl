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

import { config } from "./config.js";
import { exportJsonl, allRunIds } from "./journal.js";
import {
  diffTrajectories,
  forkTree,
  inspectRun,
  lineage,
  listForks,
  type ForkTreeNode,
} from "./inspect.js";
import { forkAndRun, type ForkDecision } from "./fork.js";

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

function printTree(node: ForkTreeNode, depth = 0): void {
  const indent = "  ".repeat(depth);
  const at = node.forkedAtSeq === null ? "root" : `fork@seq${node.forkedAtSeq}`;
  console.log(`${indent}- ${node.runId} [${node.trajectory}] (${at})`);
  for (const c of node.children) printTree(c, depth + 1);
}

const USAGE = `durabl — trajectory branching CLI (M2)

  durabl run <runId> --prompt <p> [--trajectory <t>]
  durabl fork <sourceRunId> --at <N> --new <newRunId> --prompt <p> [--trajectory <t>]
  durabl inspect <runId>
  durabl list-forks <runId>
  durabl tree <runId>
  durabl diff <runA> <runB>
  durabl export <runId> [--meta]
  durabl runs
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
