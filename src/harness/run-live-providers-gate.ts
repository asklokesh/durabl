// ─────────────────────────────────────────────────────────────────────────────
// LIVE PROVIDERS GATE — real LLM path when API keys are present.
//
//   npm run gate:live
//
// Runs ONLY when OPENAI_API_KEY, ANTHROPIC_API_KEY, and/or OPENROUTER_API_KEY
// are set. Without any keys: prints a clear SKIP message and exits 0 (CI must not
// fail for missing keys).
//
// Per provider with a key:
//   - one minimal journaled model call (recordStepAsync)
//   - assert output captured in journal (mode=real)
//   - replay short-circuit (second recordStepAsync → replayed=true)
//   - offline export → importJournalSource → replay divergence none
// ─────────────────────────────────────────────────────────────────────────────

import { resetJournal, ensureRunMeta, recordStepAsync, trajectory, exportJsonl } from "../journal.js";
import { getModelProvider } from "../providers/registry.js";
import { liveJournalSource, importJournalSource } from "../journal-source.js";
import { compareSources, reconstruct } from "../replay.js";
interface GateResult {
  name: string;
  pass: boolean;
  skipped?: boolean;
  detail: string;
}
const results: GateResult[] = [];

function record(name: string, pass: boolean, detail: string, skipped = false): void {
  results.push({ name, pass, detail, skipped });
  const tag = skipped ? "SKIP" : pass ? "PASS" : "FAIL";
  console.log(`\n[GATE ${tag}] ${name}\n  ${detail}`);
}

function hasOpenAiKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function hasAnthropicKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

function hasOpenRouterKey(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

async function exerciseProvider(providerId: string): Promise<void> {
  const runId = `live-${providerId}-${Date.now()}`;
  const provider = getModelProvider(providerId);
  const desc = provider.describe();
  if (!desc.real) {
    throw new Error(`${providerId}: expected real=true when key is set`);
  }

  ensureRunMeta(runId, "live-gate");

  const first = await recordStepAsync({
    runId,
    seq: 1,
    stepName: "step1-plan",
    kind: "plan",
    sideEffect: false,
    producer: async () => {
      const completion = await provider.complete({
        system: "Reply with one short word only.",
        prompt: "live-gate-ping",
        maxTokens: 16,
      });
      if (completion.meta.mode !== "real") {
        throw new Error(`${providerId}: expected mode=real, got ${completion.meta.mode}`);
      }
      return `${completion.text}@${completion.meta.provider}:${completion.meta.mode}`;
    },
  });

  if (first.replayed) {
    throw new Error(`${providerId}: first recordStepAsync must not replay`);
  }
  if (!first.value || String(first.value).length < 2) {
    throw new Error(`${providerId}: empty journaled output`);
  }

  const second = await recordStepAsync({
    runId,
    seq: 1,
    stepName: "step1-plan",
    kind: "plan",
    sideEffect: false,
    producer: async () => {
      throw new Error(`${providerId}: producer must not run on replay`);
    },
  });
  if (!second.replayed) {
    throw new Error(`${providerId}: second recordStepAsync must replay from journal`);
  }
  if (JSON.stringify(second.value) !== JSON.stringify(first.value)) {
    throw new Error(`${providerId}: replay value mismatch`);
  }

  const steps = trajectory(runId);
  if (steps.length !== 1) {
    throw new Error(`${providerId}: expected 1 journal step, got ${steps.length}`);
  }

  const live = reconstruct(liveJournalSource(), runId);
  const exported = exportJsonl(runId, true);
  const imported = importJournalSource(exported, `live-export-${providerId}`);
  const div = compareSources(liveJournalSource(), imported, runId);
  if (!div.identical) {
    throw new Error(
      `${providerId}: offline_divergence=${div.differences.join("; ") || "unknown"}`,
    );
  }

  record(
    `live-${providerId}`,
    true,
    `real_call=true mode=real journaled=true replayed=true offline_divergence=none outcome_len=${String(live.outcome).length}`,
  );
}

async function main(): Promise<void> {
  const openai = hasOpenAiKey();
  const anthropic = hasAnthropicKey();
  const openrouter = hasOpenRouterKey();

  if (!openai && !anthropic && !openrouter) {
    console.log(
      "\n[SKIP] live-providers-gate: no OPENAI_API_KEY, ANTHROPIC_API_KEY, or OPENROUTER_API_KEY in env — skipping real LLM path (exit 0).\n",
    );
    process.exit(0);
  }

  resetJournal();

  const planned: Array<{ id: string; run: () => Promise<void> }> = [];
  if (openai) planned.push({ id: "openai", run: () => exerciseProvider("openai") });
  if (anthropic) planned.push({ id: "anthropic", run: () => exerciseProvider("anthropic") });
  if (openrouter) planned.push({ id: "openrouter", run: () => exerciseProvider("openrouter") });

  for (const p of planned) {
    try {
      await p.run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      record(`live-${p.id}`, false, msg);
    }
  }

  const ran = results.filter((r) => !r.skipped);
  const failed = ran.filter((r) => !r.pass);
  console.log("\n================ LIVE PROVIDERS GATE ================");
  for (const r of ran) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
  }
  console.log("-----------------------------------------------------");
  console.log(
      `${ran.filter((r) => r.pass).length}/${ran.length} providers passed` +
      ` (keys: openai=${openai} anthropic=${anthropic} openrouter=${openrouter})`,
  );
  console.log(failed.length === 0 ? "VERDICT: GATE PASSED" : "VERDICT: GATE FAILED");
  console.log("=====================================================\n");
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
