// ─────────────────────────────────────────────────────────────────────────────
// DBOS JOURNAL SOURCE STUB — second-substrate seam (NOT a working DBOS integration).
//
// M3 proved replay is substrate-independent via JournalSource. This module
// documents and types the hook where a DBOS-backed journal would plug in.
// It does NOT run DBOS, connect to Postgres, or claim parity — see
// docs/SECOND-SUBSTRATE.md.
// ─────────────────────────────────────────────────────────────────────────────

import type { JournalSource } from "./journal-source.js";
import type { EffectRow } from "./effect-sink.js";
import type { JournalEntry, RunMeta } from "./step-model.js";

/** Configuration for a future DBOS journal adapter (env-driven, no secrets). */
export interface DbosJournalSourceConfig {
  /** e.g. postgresql://… (read from DBOS_DATABASE_URL at integration time). */
  readonly databaseUrl?: string;
  /** Logical workflow / app name in DBOS. */
  readonly workflowName?: string;
}

const NOT_IMPLEMENTED =
  "DBOS JournalSource is not implemented — use liveJournalSource() or importJournalSource(). " +
  "See docs/SECOND-SUBSTRATE.md for the integration contract.";

/**
 * Placeholder {@link JournalSource} showing the DBOS plug-in surface.
 * All read methods throw until a real adapter maps DBOS step rows → JournalEntry.
 */
export function dbosJournalSourceStub(
  cfg: DbosJournalSourceConfig = {},
): JournalSource {
  const origin =
    `dbos-stub(unimplemented${cfg.workflowName ? `;workflow=${cfg.workflowName}` : ""})`;

  const fail = (): never => {
    throw new Error(NOT_IMPLEMENTED);
  };

  return {
    origin,
    trajectory: (_runId: string): JournalEntry[] => fail(),
    runMeta: (_runId: string): RunMeta | undefined => fail(),
    childRuns: (_parentRunId: string): RunMeta[] => fail(),
    effectsFor: (_runId: string): EffectRow[] => fail(),
    allRunIds: (): string[] => fail(),
  };
}

/** True when a real DBOS adapter should be selected (future; always false today). */
export function dbosJournalSourceAvailable(): boolean {
  return process.env.DURABL_JOURNAL_SOURCE === "dbos" && Boolean(process.env.DBOS_DATABASE_URL);
}

/**
 * Resolve journal source for harness/tests. Today: only live + import paths work;
 * `dbos` env selects the stub and fails loudly if invoked.
 */
export function resolveJournalSourceHint(): "live" | "import" | "dbos-stub" {
  const src = process.env.DURABL_JOURNAL_SOURCE ?? "live";
  if (src === "dbos") return "dbos-stub";
  if (src === "import") return "import";
  return "live";
}
