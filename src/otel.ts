// Optional workflow-step tracing hooks (no OpenTelemetry SDK dependency).
//
// When DURABL_OTEL_ENDPOINT is unset, every hook is a no-op passthrough.
// When set, each journaled step emits a small JSON POST (fire-and-forget) so a
// collector or sidecar can ingest spans without coupling durability code to a
// vendor SDK. Failures are swallowed — observability must never break runs.

import { config } from "./config.js";

/** Attributes attached to every step span (no secrets, no step output). */
export interface StepSpanAttributes {
  readonly runId: string;
  readonly stepName: string;
  readonly kind: string;
  readonly seq: number;
  readonly sideEffect: boolean;
}

export function isOtelEnabled(): boolean {
  return config.otelEndpoint.length > 0;
}

function emitStepEvent(payload: Record<string, unknown>): void {
  const url = config.otelEndpoint;
  if (!url) return;
  // SECURITY-REVIEW: user-controlled URL from env; only POST minimal run metadata.
  void fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {
    /* observability is best-effort */
  });
}

/** Wrap synchronous step work. No-op when {@link isOtelEnabled} is false. */
export function withStepSpan<T>(
  attrs: StepSpanAttributes,
  fn: () => T,
  after?: (result: T) => { readonly replayed?: boolean },
): T {
  if (!isOtelEnabled()) return fn();

  const start = performance.now();
  try {
    const value = fn();
    const replayed = after?.(value).replayed ?? false;
    emitStepEvent({
      type: "durabl.step",
      ...attrs,
      replayed,
      ok: true,
      durationMs: performance.now() - start,
      recordedAt: new Date().toISOString(),
    });
    return value;
  } catch (err) {
    emitStepEvent({
      type: "durabl.step",
      ...attrs,
      replayed: false,
      ok: false,
      durationMs: performance.now() - start,
      error: err instanceof Error ? err.name : "Error",
      recordedAt: new Date().toISOString(),
    });
    throw err;
  }
}

/** Wrap asynchronous step work. No-op when {@link isOtelEnabled} is false. */
export async function withStepSpanAsync<T>(
  attrs: StepSpanAttributes,
  fn: () => Promise<T>,
  after?: (result: T) => { readonly replayed?: boolean },
): Promise<T> {
  if (!isOtelEnabled()) return fn();

  const start = performance.now();
  try {
    const value = await fn();
    const replayed = after?.(value).replayed ?? false;
    emitStepEvent({
      type: "durabl.step",
      ...attrs,
      replayed,
      ok: true,
      durationMs: performance.now() - start,
      recordedAt: new Date().toISOString(),
    });
    return value;
  } catch (err) {
    emitStepEvent({
      type: "durabl.step",
      ...attrs,
      replayed: false,
      ok: false,
      durationMs: performance.now() - start,
      error: err instanceof Error ? err.name : "Error",
      recordedAt: new Date().toISOString(),
    });
    throw err;
  }
}
