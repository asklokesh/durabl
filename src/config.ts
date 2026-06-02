// Centralized configuration. All tunables come from environment variables so
// nothing operational is hardcoded (security baseline §1, §7). No secrets are
// read or logged here; these are filesystem paths and ports only.

import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.env.DURABL_DATA_DIR ?? join(tmpdir(), "durabl-m1");

export const config = {
  /** Neutral portable step journal (the product surface). */
  journalDbPath: process.env.DURABL_JOURNAL_DB ?? join(ROOT, "journal.db"),
  /** External idempotent effect sink (the exactly-once detector). */
  effectDbPath: process.env.DURABL_EFFECT_DB ?? join(ROOT, "effects.db"),
  /** Restate SDK service listen port. */
  servicePort: Number(process.env.DURABL_SERVICE_PORT ?? 9080),
  /** Restate data dir (engine state); harness-managed. */
  restateDataDir: process.env.DURABL_RESTATE_DATA_DIR ?? join(ROOT, "restate-data"),
  /** Restate ingress + admin (single self-hostable binary). */
  restateIngress: process.env.DURABL_RESTATE_INGRESS ?? "http://localhost:8080",
  restateAdmin: process.env.DURABL_RESTATE_ADMIN ?? "http://localhost:9070",
  /**
   * Optional HTTP endpoint for step-span JSON POSTs (see `src/otel.ts`).
   * Unset → tracing hooks are no-ops with zero network I/O.
   */
  otelEndpoint: process.env.DURABL_OTEL_ENDPOINT ?? "",
} as const;

export const DATA_ROOT = ROOT;
