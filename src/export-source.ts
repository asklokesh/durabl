// Portable JSONL export from any JournalSource (live SQLite or imported export).

import type { JournalSource } from "./journal-source.js";

export function exportJsonlFromSource(source: JournalSource, runId: string): string {
  const lines: string[] = [];
  const meta = source.runMeta(runId);
  if (meta) lines.push(JSON.stringify({ record: "run_meta", ...meta }));
  for (const e of source.trajectory(runId)) {
    lines.push(JSON.stringify({ record: "step", ...e }));
  }
  for (const r of source.effectsFor(runId)) {
    lines.push(
      JSON.stringify({
        record: "effect",
        id: r.id,
        runId: r.run_id,
        trajectory: r.trajectory,
        stepName: r.step_name,
        idemKey: r.idem_key,
        payload: JSON.parse(r.payload) as unknown,
        firedAt: r.fired_at,
        pid: r.pid,
      }),
    );
  }
  return lines.join("\n");
}

export function exportBundleJsonlFromSource(source: JournalSource, rootRunId: string): string {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (runId: string): void => {
    if (seen.has(runId)) return;
    seen.add(runId);
    const body = exportJsonlFromSource(source, runId);
    if (body) out.push(body);
    for (const c of source.childRuns(runId)) visit(c.runId);
  };
  visit(rootRunId);
  return out.join("\n");
}
