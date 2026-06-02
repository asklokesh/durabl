// MCP tool surface — programmatic dispatch over the portable journal (stub).
// A full MCP transport (stdio/HTTP) belongs in a separate host process that calls
// handleDurablMcpToolCall; this module stays side-effect bounded per tool.

import { inspectRun, lineage } from "./inspect.js";
import {
  lineageFrom,
  listForksFrom,
  forkTreeFrom,
} from "./inspect-source.js";
import {
  liveJournalSource,
  importJournalSource,
  type JournalSource,
} from "./journal-source.js";
import { reconstruct, stateAt } from "./replay.js";
import {
  validateForkPlan,
  seedFork,
  ForkError,
  type ForkPlan,
} from "./fork.js";
import { deriveIdempotencyKey } from "./idempotency.js";

/** Tool names exposed by the Durabl MCP integration (stable contract). */
export const DURABL_MCP_TOOLS = [
  "inspect_run",
  "inspect_lineage",
  "inspect_list_forks",
  "inspect_fork_tree",
  "replay_reconstruct",
  "replay_state_at",
  "fork_validate",
  "fork_seed",
  "fork_and_run",
] as const;

export type DurablMcpToolName = (typeof DURABL_MCP_TOOLS)[number];

export type DurablMcpToolResult =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly error: string; readonly code?: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.trim() === "") {
    throw new Error(`missing or invalid string argument: ${key}`);
  }
  return v;
}

function optionalJsonl(args: Record<string, unknown>): string | undefined {
  const v = args["jsonl"];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") {
    throw new Error("jsonl must be a string when provided");
  }
  return v;
}

// SECURITY-REVIEW: Imported JSONL is untrusted external input; size limits and
// schema validation must be enforced by the MCP transport host before calling here.
function resolveJournalSource(jsonl: string | undefined): JournalSource {
  if (jsonl !== undefined) {
    return importJournalSource(jsonl);
  }
  return liveJournalSource();
}

function parseForkPlan(args: Record<string, unknown>): ForkPlan {
  const sourceRunId = requireString(args, "sourceRunId");
  const newRunId = requireString(args, "newRunId");
  const throughSeq = args["throughSeq"];
  if (typeof throughSeq !== "number" || !Number.isInteger(throughSeq)) {
    throw new Error("missing or invalid integer argument: throughSeq");
  }
  const decisionRaw = args["decision"];
  if (!isRecord(decisionRaw)) {
    throw new Error("missing or invalid object argument: decision");
  }
  const prompt = requireString(decisionRaw, "prompt");
  const trajectory = requireString(decisionRaw, "trajectory");
  return { sourceRunId, newRunId, throughSeq, decision: { prompt, trajectory } };
}

function forkFailure(e: unknown): DurablMcpToolResult {
  if (e instanceof ForkError) {
    return { ok: false, error: e.message, code: "FORK_ERROR" };
  }
  const message = e instanceof Error ? e.message : String(e);
  return { ok: false, error: message };
}

/**
 * Dispatch a single Durabl MCP tool by name. Read-only inspect/replay tools never
 * mutate the journal; fork_seed mutates the local journal only.
 */
export function handleDurablMcpToolCall(
  name: DurablMcpToolName,
  args: unknown,
): DurablMcpToolResult {
  if (!isRecord(args)) {
    return { ok: false, error: "arguments must be a JSON object" };
  }

  try {
    switch (name) {
      case "inspect_run": {
        const runId = requireString(args, "runId");
        const jsonl = optionalJsonl(args);
        if (jsonl === undefined) {
          return { ok: true, data: inspectRun(runId) };
        }
        const source = resolveJournalSource(jsonl);
        return {
          ok: true,
          data: {
            runId,
            meta: source.runMeta(runId),
            steps: source.trajectory(runId),
            lineage: lineageFrom(source, runId),
            forks: listForksFrom(source, runId),
            origin: source.origin,
          },
        };
      }
      case "inspect_lineage": {
        const runId = requireString(args, "runId");
        const jsonl = optionalJsonl(args);
        if (jsonl === undefined) {
          return { ok: true, data: lineage(runId) };
        }
        const source = resolveJournalSource(jsonl);
        return { ok: true, data: lineageFrom(source, runId) };
      }
      case "inspect_list_forks": {
        const runId = requireString(args, "runId");
        const source = resolveJournalSource(optionalJsonl(args));
        return { ok: true, data: listForksFrom(source, runId) };
      }
      case "inspect_fork_tree": {
        const rootId = requireString(args, "rootId");
        const source = resolveJournalSource(optionalJsonl(args));
        return { ok: true, data: forkTreeFrom(source, rootId) };
      }
      case "replay_reconstruct": {
        const runId = requireString(args, "runId");
        const source = resolveJournalSource(optionalJsonl(args));
        return { ok: true, data: reconstruct(source, runId) };
      }
      case "replay_state_at": {
        const runId = requireString(args, "runId");
        const n = args["n"];
        if (typeof n !== "number" || !Number.isInteger(n)) {
          throw new Error("missing or invalid integer argument: n");
        }
        const source = resolveJournalSource(optionalJsonl(args));
        return { ok: true, data: stateAt(source, runId, n) };
      }
      case "fork_validate": {
        const plan = parseForkPlan(args);
        validateForkPlan(plan);
        deriveIdempotencyKey(plan.newRunId, "mcp-fork-validate");
        return { ok: true, data: { valid: true, plan } };
      }
      case "fork_seed": {
        const plan = parseForkPlan(args);
        const seededSteps = seedFork(plan);
        return { ok: true, data: { seededSteps, plan } };
      }
      case "fork_and_run":
        // SECURITY-REVIEW: Substrate/workflow invoke is out of scope for the MCP stub;
        // a transport host must authenticate callers and inject SubstrateInvoke explicitly.
        return {
          ok: false,
          code: "NOT_IMPLEMENTED",
          error:
            "fork_and_run is not implemented in the MCP stub; use fork_seed plus your workflow ingress.",
        };
      default: {
        const _exhaustive: never = name;
        return { ok: false, error: `unknown tool: ${String(_exhaustive)}` };
      }
    }
  } catch (e) {
    if (name === "fork_validate" || name === "fork_seed") {
      return forkFailure(e);
    }
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}
