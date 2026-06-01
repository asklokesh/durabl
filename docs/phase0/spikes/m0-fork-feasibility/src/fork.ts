// THROWAWAY SPIKE CODE — not production.
// Logical step-level fork driver. Seeds a new run from a source run's journal
// up to seq N, then invokes the workflow for the new run. Because the forked
// run's journal already contains steps 1..N (with the SIDE-EFFECT step among
// them), recordOnce short-circuits them on replay — the side effect does NOT
// re-fire. The new run then diverges past N.

import { forkRun, trajectory } from "./journal.js";

const INGRESS = process.env.RESTATE_INGRESS ?? "http://localhost:8080";

export async function invokeRun(
  runId: string,
  input: { prompt: string; trajectory?: string },
): Promise<any> {
  const res = await fetch(`${INGRESS}/AgentRun/${runId}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`invoke failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function fork(
  sourceRunId: string,
  newRunId: string,
  throughSeq: number,
  newTrajectory: string,
  divergePrompt: string,
): Promise<{ seeded: number; result: any }> {
  const seeded = forkRun(sourceRunId, newRunId, throughSeq, newTrajectory);
  const result = await invokeRun(newRunId, {
    prompt: divergePrompt,
    trajectory: newTrajectory,
  });
  return { seeded, result };
}

// CLI entry: node dist/fork.js <source> <new> <throughSeq> <traj> <prompt>
if (process.argv[1]?.endsWith("fork.js")) {
  const [, , src, neu, seq, traj, prompt] = process.argv;
  fork(src, neu, Number(seq), traj ?? "fork", prompt ?? "diverged")
    .then((r) => {
      console.log("seeded:", r.seeded);
      console.log("result:", JSON.stringify(r.result));
      console.log("source trajectory seqs:", trajectory(src).map((e) => e.seq));
      console.log("forked trajectory seqs:", trajectory(neu).map((e) => e.seq));
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
