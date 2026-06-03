// ─────────────────────────────────────────────────────────────────────────────
// DBOS GATE — file-backed JournalSource adapter parity (no Postgres / DBOS SDK).
//
//   npm run gate:dbos
//
// Proves dbosJournalSourceFromPath reconstructs the same runs as importJournalSource
// on the committed M3 portable bundle. Postgres live adapter remains NOT RUN.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { enterHarnessGate, exitHarnessGate } from "./restate-control.js";
import { FIXTURE_M3_PORTABLE } from "./fixture-paths.js";
import { importJournalSource } from "../journal-source.js";
import {
  dbosJournalSourceFromPath,
  dbosJournalSourceStub,
  dbosExportJournalSourceAvailable,
  resolveJournalSourceHint,
} from "../journal-source-dbos-stub.js";
import { assertReplayMatches, reconstruct } from "../replay.js";

const RUN_IDS = [
  "m3-root-1780353444814",
  "m3-forkA-1780353444814",
  "m3-forkB-1780353444814",
  "m3-subforkB-1780353444814",
] as const;

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

function gateD1(): void {
  const available = dbosExportJournalSourceAvailable(FIXTURE_M3_PORTABLE);
  const src = dbosJournalSourceFromPath(FIXTURE_M3_PORTABLE, {
    exportPath: FIXTURE_M3_PORTABLE,
    workflowName: "AgentRun",
  });
  const ids = src.allRunIds();
  const pass =
    available &&
    src.origin.startsWith("dbos-journal(") &&
    ids.length === RUN_IDS.length &&
    RUN_IDS.every((id) => ids.includes(id));
  record(
    "D1 dbos-export-loads-fixture",
    pass,
    `available=${available} origin=${src.origin} run_count=${ids.length}`,
  );
}

function gateD2(): void {
  const jsonl = readFileSync(FIXTURE_M3_PORTABLE, "utf8");
  const imp = importJournalSource(jsonl, "imported:m3-fixture");
  const dbos = dbosJournalSourceFromPath(FIXTURE_M3_PORTABLE, {
    exportPath: FIXTURE_M3_PORTABLE,
    workflowName: "AgentRun",
  });

  const divergences: string[] = [];
  for (const runId of RUN_IDS) {
    const div = assertReplayMatches(reconstruct(imp, runId), reconstruct(dbos, runId));
    if (!div.identical) divergences.push(`${runId}:${div.differences.join(";")}`);
  }
  const pass = divergences.length === 0;
  record(
    "D2 dbos-export-replay-parity-vs-import",
    pass,
    divergences.length === 0 ? "all_runs=identical" : divergences.join(" | "),
  );
}

function gateD3(): void {
  const stub = dbosJournalSourceStub({ workflowName: "AgentRun" });
  let threw = false;
  try {
    stub.trajectory("run-1");
  } catch (e) {
    threw = e instanceof Error && e.message.includes("not implemented");
  }
  record(
    "D3 dbos-stub-still-throws-without-export",
    threw && stub.origin.startsWith("dbos-stub"),
    `stub_throws=${threw} origin=${stub.origin}`,
  );
}

function gateD4(): void {
  const prevSource = process.env.DURABL_JOURNAL_SOURCE;
  const prevExport = process.env.DBOS_JOURNAL_EXPORT;
  try {
    delete process.env.DURABL_JOURNAL_SOURCE;
    delete process.env.DBOS_JOURNAL_EXPORT;
    const liveHint = resolveJournalSourceHint();

    process.env.DURABL_JOURNAL_SOURCE = "dbos";
    process.env.DBOS_JOURNAL_EXPORT = FIXTURE_M3_PORTABLE;
    const exportHint = resolveJournalSourceHint();

    delete process.env.DBOS_JOURNAL_EXPORT;
    const stubHint = resolveJournalSourceHint();

    const pass = liveHint === "live" && exportHint === "dbos-export" && stubHint === "dbos-stub";
    record(
      "D4 resolve-journal-source-hint",
      pass,
      `default=${liveHint} with_export=${exportHint} dbos_no_export=${stubHint}`,
    );
  } finally {
    if (prevSource === undefined) delete process.env.DURABL_JOURNAL_SOURCE;
    else process.env.DURABL_JOURNAL_SOURCE = prevSource;
    if (prevExport === undefined) delete process.env.DBOS_JOURNAL_EXPORT;
    else process.env.DBOS_JOURNAL_EXPORT = prevExport;
  }
}

async function main(): Promise<void> {
  await enterHarnessGate();
  console.log("# DBOS gate — file-backed adapter (Postgres adapter NOT RUN)\n");
  gateD1();
  gateD2();
  gateD3();
  gateD4();

  const failed = results.filter((r) => !r.pass);
  if (failed.length > 0) {
    console.error("\nVERDICT: GATE FAILED");
    for (const f of failed) console.error(`  - ${f.name}: ${f.detail}`);
    await exitHarnessGate();
    process.exit(1);
  }
  console.log("\n[SKIP] DBOS Postgres / SDK live reads — NOT RUN");
  console.log("VERDICT: gate:dbos PASSED (file-export adapter)");
  await exitHarnessGate();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  await exitHarnessGate();
  process.exit(1);
});
