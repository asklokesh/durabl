// Structured HTTP logging for the replay UI server. No journal bodies, run
// payloads, or credential values are logged.

export function logServerStart(host: string, port: number, label: string): void {
  console.error(`[durabl-ui] listening http://${host}:${port} (${label})`);
}

export function logHttpRequest(
  method: string,
  path: string,
  status: number,
  durationMs: number,
): void {
  console.error(`[durabl-ui] ${method} ${path} ${status} ${durationMs}ms`);
}

export function logServerError(context: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[durabl-ui] ${context}: ${msg}`);
}
