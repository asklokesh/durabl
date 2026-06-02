// Structured, key-free provider errors (hardening — safe to log/journal).

/** Machine-readable provider failure codes. */
export type ProviderErrorCode =
  | "http_error"
  | "timeout"
  | "network"
  | "invalid_response"
  | "aborted";

/** Redacted provider error — never includes API key material. */
export class ProviderError extends Error {
  override readonly name = "ProviderError";

  constructor(
    readonly code: ProviderErrorCode,
    readonly provider: string,
    message: string,
    readonly status?: number,
    readonly underlying?: unknown,
  ) {
    super(message, underlying instanceof Error ? { cause: underlying } : undefined);
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      provider: this.provider,
      message: this.message,
      ...(this.status !== undefined ? { status: this.status } : {}),
    };
  }
}

/** Strip common credential patterns from error text before surfacing. */
export function redactSecrets(text: string): string {
  let out = text;
  out = out.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
  out = out.replace(/sk-[A-Za-z0-9]{8,}/g, "sk-[REDACTED]");
  out = out.replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, "sk-ant-[REDACTED]");
  out = out.replace(
    /(["']?(?:api[_-]?key|authorization|x-api-key)["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi,
    "$1[REDACTED]",
  );
  return out;
}
