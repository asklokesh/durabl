// ─────────────────────────────────────────────────────────────────────────────
// DBOS JOURNAL SOURCE — second-substrate seam.
//
// M3 proved replay is substrate-independent via JournalSource. This module
// provides:
//   - dbosJournalSourceFromExport / FromPath — file-backed adapter (shipped)
//   - dbosJournalSourceStub — throwing placeholder when no export is configured
//   - dbosJournalSource — resolves export path from config/env, else stub
//
// Live Postgres + DBOS SDK reads are NOT implemented — see docs/integrations/dbos.md.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import type { JournalSource } from "./journal-source.js";
import { importJournalSource } from "./journal-source.js";
import type { EffectRow } from "./effect-sink.js";
import type { JournalEntry, RunMeta } from "./step-model.js";

/** Configuration for the DBOS journal adapter (env-driven, no secrets in code). */
export interface DbosJournalSourceConfig {
  /** Reserved for future Postgres adapter (e.g. from DBOS_DATABASE_URL). */
  readonly databaseUrl?: string;
  /** Logical workflow / app name in DBOS. */
  readonly workflowName?: string;
  /** Portable JSONL export path (DBOS_JOURNAL_EXPORT). */
  readonly exportPath?: string;
}

const NOT_IMPLEMENTED =
  "DBOS JournalSource is not implemented — use liveJournalSource() or importJournalSource(). " +
  "See docs/SECOND-SUBSTRATE.md for the integration contract.";

const NOT_IMPLEMENTED_POSTGRES =
  "DBOS Postgres JournalSource is not implemented — set DBOS_JOURNAL_EXPORT to a portable " +
  "JSONL export or use liveJournalSource() / importJournalSource(). " +
  "See docs/integrations/dbos.md.";

function workflowLabel(cfg: DbosJournalSourceConfig): string {
  return cfg.workflowName ?? process.env.DBOS_WORKFLOW_NAME ?? "AgentRun";
}

/** Stable origin label for evidence / replay divergence reports. */
export function dbosJournalOrigin(cfg: DbosJournalSourceConfig, mode: "export" | "stub"): string {
  const wf = workflowLabel(cfg);
  if (mode === "stub") {
    return `dbos-stub(unimplemented;workflow=${wf})`;
  }
  const exportHint = cfg.exportPath ? `export=${basename(cfg.exportPath)}` : "export=inline";
  return `dbos-journal(${exportHint};workflow=${wf})`;
}

/** Merge explicit config with DBOS_* / DURABL_* env (no credential logging). */
export function readDbosJournalSourceConfigFromEnv(): DbosJournalSourceConfig {
  return {
    databaseUrl: process.env.DBOS_DATABASE_URL,
    workflowName: process.env.DBOS_WORKFLOW_NAME,
    exportPath: process.env.DBOS_JOURNAL_EXPORT,
  };
}

/**
 * File-backed {@link JournalSource}: reads a portable durabl JSONL export produced
 * from any substrate (including a future DBOS workflow export). Same replay surface
 * as {@link importJournalSource}; origin is labeled for DBOS evidence.
 */
export function dbosJournalSourceFromExport(
  jsonl: string,
  cfg: DbosJournalSourceConfig = {},
): JournalSource {
  const origin = dbosJournalOrigin(cfg, "export");
  return importJournalSource(jsonl, origin);
}

/**
 * Load export from disk. Path must exist; caller supplies an absolute or cwd-relative path.
 */
export function dbosJournalSourceFromPath(
  exportPath: string,
  cfg: DbosJournalSourceConfig = {},
): JournalSource {
  if (!existsSync(exportPath)) {
    throw new Error(`DBOS journal export not found: ${exportPath}`);
  }
  const jsonl = readFileSync(exportPath, "utf8");
  return dbosJournalSourceFromExport(jsonl, { ...cfg, exportPath });
}

/**
 * Placeholder {@link JournalSource} when DBOS mode is selected but no export path is set.
 * All read methods throw until a Postgres adapter exists.
 */
export function dbosJournalSourceStub(
  cfg: DbosJournalSourceConfig = {},
): JournalSource {
  const origin = dbosJournalOrigin(cfg, "stub");
  const fail = (): never => {
    throw new Error(
      process.env.DBOS_DATABASE_URL && !cfg.exportPath && !process.env.DBOS_JOURNAL_EXPORT
        ? NOT_IMPLEMENTED_POSTGRES
        : NOT_IMPLEMENTED,
    );
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

/** True when a readable portable export is configured (file-backed adapter). */
export function dbosExportJournalSourceAvailable(exportPath?: string): boolean {
  const p = exportPath ?? process.env.DBOS_JOURNAL_EXPORT;
  return Boolean(p && existsSync(p));
}

/**
 * True when {@link dbosJournalSource} will return the file-backed adapter (not the stub).
 */
export function dbosJournalSourceAvailable(): boolean {
  return dbosExportJournalSourceAvailable();
}

/**
 * Resolve config → adapter: export file when configured, else throwing stub.
 */
export function dbosJournalSource(cfg: DbosJournalSourceConfig = {}): JournalSource {
  const merged = { ...readDbosJournalSourceConfigFromEnv(), ...cfg };
  if (merged.exportPath) {
    return dbosJournalSourceFromPath(merged.exportPath, merged);
  }
  return dbosJournalSourceStub(merged);
}

/**
 * Resolve journal source for harness/tests.
 * `dbos` + export file → `dbos-export`; `dbos` without export → `dbos-stub`.
 */
export function resolveJournalSourceHint():
  | "live"
  | "import"
  | "dbos-export"
  | "dbos-stub" {
  const src = process.env.DURABL_JOURNAL_SOURCE ?? "live";
  if (src === "dbos") {
    return dbosExportJournalSourceAvailable() ? "dbos-export" : "dbos-stub";
  }
  if (src === "import") return "import";
  return "live";
}
