// Centralized configuration. All tunables come from environment variables so
// nothing operational is hardcoded (security baseline §1, §7). No secrets are
// read or logged here; these are filesystem paths and ports only.

import { tmpdir } from "node:os";
import { join } from "node:path";

/** Thrown when required env / derived config is invalid (fail fast at startup). */
export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

const ROOT = process.env.DURABL_DATA_DIR ?? join(tmpdir(), "durabl-m1");

const PORT_MIN = 1;
const PORT_MAX = 65_535;

function parsePortEnv(envKey: string, fallback: number): number {
  const raw = process.env[envKey];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    throw new ConfigError(
      `${envKey} must be an integer TCP port (got ${JSON.stringify(raw)})`,
    );
  }
  return n;
}

function assertPortInRange(port: number, label: string): void {
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) {
    throw new ConfigError(
      `${label} must be an integer between ${PORT_MIN} and ${PORT_MAX} (got ${port})`,
    );
  }
}

function assertHttpUrl(url: string, label: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ConfigError(`${label} must be a valid URL (got ${JSON.stringify(url)})`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ConfigError(
      `${label} must use http or https (got ${parsed.protocol})`,
    );
  }
}

function assertNonEmptyPath(path: string, label: string): void {
  if (!path.trim()) {
    throw new ConfigError(`${label} must be a non-empty path`);
  }
}

export const config = {
  /** Neutral portable step journal (the product surface). */
  journalDbPath: process.env.DURABL_JOURNAL_DB ?? join(ROOT, "journal.db"),
  /** External idempotent effect sink (the exactly-once detector). */
  effectDbPath: process.env.DURABL_EFFECT_DB ?? join(ROOT, "effects.db"),
  /** Restate SDK service listen port. */
  servicePort: parsePortEnv("DURABL_SERVICE_PORT", 9080),
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
  /**
   * Reserved for M6 multi-tenant routing. Unset → single-tenant self-host (default).
   * Non-empty value is accepted but does not change journal or API behavior yet.
   * See `docs/architecture/m6-saas.md`.
   */
  tenantId: process.env.DURABL_TENANT_ID?.trim() ?? "",
} as const;

export const DATA_ROOT = ROOT;

/**
 * Validate {@link config} and related env knobs. Call at process startup before
 * binding servers or opening ingress clients.
 */
export function validateConfig(): void {
  assertPortInRange(config.servicePort, "DURABL_SERVICE_PORT");
  assertHttpUrl(config.restateIngress, "DURABL_RESTATE_INGRESS");
  assertHttpUrl(config.restateAdmin, "DURABL_RESTATE_ADMIN");
  assertNonEmptyPath(config.journalDbPath, "DURABL_JOURNAL_DB");
  assertNonEmptyPath(config.effectDbPath, "DURABL_EFFECT_DB");
  assertNonEmptyPath(config.restateDataDir, "DURABL_RESTATE_DATA_DIR");

  const uiPortRaw = process.env.DURABL_UI_PORT;
  if (uiPortRaw !== undefined && uiPortRaw !== "") {
    const uiPort = Number(uiPortRaw);
    if (!Number.isInteger(uiPort)) {
      throw new ConfigError(
        `DURABL_UI_PORT must be an integer TCP port (got ${JSON.stringify(uiPortRaw)})`,
      );
    }
    assertPortInRange(uiPort, "DURABL_UI_PORT");
  }

  const uiHost = process.env.DURABL_UI_HOST;
  if (uiHost !== undefined && !uiHost.trim()) {
    throw new ConfigError("DURABL_UI_HOST must not be empty when set");
  }
}
