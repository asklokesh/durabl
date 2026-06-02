// Structured backend logging for the replay UI HTTP server.
// SECURITY-REVIEW: request logs must never include PII, secrets, or journal bodies.

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function configuredLevel(): LogLevel {
  const raw = (process.env.DURABL_LOG_LEVEL ?? "info").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw;
  return "info";
}

function requestsEnabled(): boolean {
  const v = process.env.DURABL_LOG_REQUESTS;
  if (v === "0" || v === "false" || v === "off") return false;
  return true;
}

function shouldEmit(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[configuredLevel()];
}

function emit(level: LogLevel, event: string, fields: Record<string, unknown>): void {
  if (!shouldEmit(level)) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  });
  process.stderr.write(`${line}\n`);
}

export function logServerStart(fields: {
  url: string;
  origin: string;
  live: boolean;
}): void {
  emit("info", "server.start", fields);
}

export function logHttpRequest(fields: {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  live?: boolean;
}): void {
  if (!requestsEnabled()) return;
  emit("info", "http.request", fields);
}

export function logServerError(fields: { message: string; path?: string }): void {
  emit("error", "server.error", fields);
}
