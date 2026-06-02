// Bounded HTTP policy for model providers: timeout, retry, redacted errors.

import { ProviderError, redactSecrets } from "./provider-errors.js";

export interface ProviderHttpPolicy {
  readonly provider: string;
  /** Per-attempt timeout (ms). */
  readonly timeoutMs: number;
  /** Max attempts including the first (bounded retry). */
  readonly maxAttempts: number;
  /** Base backoff between retries (ms), doubled per attempt. */
  readonly retryBackoffMs: number;
}

const DEFAULT_POLICY: Omit<ProviderHttpPolicy, "provider"> = {
  timeoutMs: Number(process.env.DURABL_PROVIDER_TIMEOUT_MS ?? 30_000),
  maxAttempts: Number(process.env.DURABL_PROVIDER_MAX_ATTEMPTS ?? 3),
  retryBackoffMs: Number(process.env.DURABL_PROVIDER_RETRY_BACKOFF_MS ?? 500),
};

export function defaultProviderHttpPolicy(provider: string): ProviderHttpPolicy {
  return { provider, ...DEFAULT_POLICY };
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch with timeout + bounded retries. Throws {@link ProviderError} with
 * redacted messages — never includes API key material.
 */
export async function fetchWithProviderPolicy(
  url: string,
  init: RequestInit,
  policy: ProviderHttpPolicy,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const { provider, timeoutMs, maxAttempts, retryBackoffMs } = policy;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchFn(url, { ...init, signal: controller.signal });
      if (res.ok) return res;
      if (!isRetryableStatus(res.status) || attempt === maxAttempts) {
        const bodySnippet = redactSecrets((await res.text()).slice(0, 200));
        throw new ProviderError(
          "http_error",
          provider,
          `${provider} HTTP ${res.status}${bodySnippet ? `: ${bodySnippet}` : ""}`,
          res.status,
        );
      }
      lastError = new ProviderError(
        "http_error",
        provider,
        `${provider} HTTP ${res.status} (retryable)`,
        res.status,
      );
    } catch (e) {
      if (e instanceof ProviderError) {
        lastError = e;
        if (!isRetryableStatus(e.status ?? 0) && e.code === "http_error") throw e;
      } else if (e instanceof Error && e.name === "AbortError") {
        lastError = new ProviderError("timeout", provider, `${provider} request timed out after ${timeoutMs}ms`);
      } else {
        const msg = redactSecrets(e instanceof Error ? e.message : String(e));
        lastError = new ProviderError("network", provider, `${provider} network error: ${msg}`, undefined, e as Error);
      }
    } finally {
      clearTimeout(timer);
    }

    if (attempt < maxAttempts) {
      await sleep(retryBackoffMs * 2 ** (attempt - 1));
    }
  }

  if (lastError instanceof ProviderError) throw lastError;
  throw new ProviderError("network", provider, `${provider} request failed after ${maxAttempts} attempts`);
}
