// ─────────────────────────────────────────────────────────────────────────────
// HARDEN GATE — provider policy smoke + second-substrate seam + live providers.
//
//   npm run gate:harden
//
// Always passes in CI without API keys (live sub-gate skips). Sub-gates:
//   H1 provider-error-redaction
//   H2 dbos-journal-source-stub (interface only — not a working DBOS run)
//   H3 live-providers (delegates to run-live-providers-gate logic)
// ─────────────────────────────────────────────────────────────────────────────

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { enterHarnessGate, exitHarnessGate } from "./restate-control.js";
import { redactSecrets, ProviderError } from "../providers/provider-errors.js";
import {
  dbosJournalSourceStub,
  resolveJournalSourceHint,
} from "../journal-source-dbos-stub.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

function gateH1(): void {
  const raw = "Bearer sk-secret123 failed; api_key=abc123";
  const redacted = redactSecrets(raw);
  const ok =
    !redacted.includes("sk-secret123") &&
    !redacted.includes("abc123") &&
    redacted.includes("[REDACTED]");
  const err = new ProviderError("http_error", "openai", "openai HTTP 401", 401);
  const json = JSON.stringify(err.toJSON());
  const jsonOk = !json.includes("sk-") && json.includes('"code":"http_error"');
  record(
    "H1 provider-error-redaction",
    ok && jsonOk,
    `redact_ok=${ok} structured_error_ok=${jsonOk}`,
  );
}

function gateH2(): void {
  const stub = dbosJournalSourceStub({ workflowName: "AgentRun" });
  let threw = false;
  try {
    stub.trajectory("run-1");
  } catch (e) {
    threw = e instanceof Error && e.message.includes("not implemented");
  }
  const hint = resolveJournalSourceHint();
  record(
    "H2 dbos-journal-source-stub",
    threw && stub.origin.startsWith("dbos-stub"),
    `stub_throws=${threw} origin=${stub.origin} default_hint=${hint}`,
  );
}

function gateH3(): void {
  const script = resolve(__dirname, "run-live-providers-gate.js");
  const r = spawnSync(process.execPath, ["--enable-source-maps", script], {
    encoding: "utf8",
    env: process.env,
  });
  const combined = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const skipped = combined.includes("[SKIP] live-providers-gate");
  const passed = r.status === 0 && (skipped || combined.includes("VERDICT: GATE PASSED"));
  record(
    "H3 live-providers",
    passed,
    skipped
      ? "skipped (no API keys; exit 0)"
      : `exit=${r.status ?? "?"} ${combined.split("\n").find((l) => l.includes("VERDICT")) ?? ""}`.trim(),
  );
}

async function main(): Promise<void> {
  await enterHarnessGate();
  try {
    gateH1();
    gateH2();
    gateH3();

    const failed = results.filter((r) => !r.pass);
    console.log("\n================ HARDEN GATE SUMMARY ================");
    for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
    console.log("-----------------------------------------------------");
    console.log(`${results.length - failed.length}/${results.length} gates passed`);
    console.log(failed.length === 0 ? "VERDICT: GATE PASSED" : "VERDICT: GATE FAILED");
    console.log("=====================================================\n");
    process.exitCode = failed.length === 0 ? 0 : 1;
  } finally {
    await exitHarnessGate();
  }
}

main().catch((e) => {
  console.error("HARDEN GATE ERROR:", e);
  process.exitCode = 3;
});
