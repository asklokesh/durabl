// SECURITY-REVIEW: Optional shared-secret gate for mutating /api/* when the replay UI
// is bound beyond localhost. Enabled only when DURABL_API_KEY is set (non-empty); no
// default key. Compares via SHA-256 digests to avoid timing leaks on length mismatch.
// Never logs presented or configured key material.

import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function configuredApiKey(): string | undefined {
  const key = process.env.DURABL_API_KEY?.trim();
  return key ? key : undefined;
}

export function isMutatingMethod(method: string | undefined): boolean {
  return MUTATING.has((method ?? "GET").toUpperCase());
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function keysMatch(presented: string, expected: string): boolean {
  return timingSafeEqual(digest(presented), digest(expected));
}

export function extractApiKey(req: IncomingMessage): string | undefined {
  const raw = req.headers["x-api-key"];
  const fromHeader = Array.isArray(raw) ? raw[0] : raw;
  if (typeof fromHeader === "string" && fromHeader.trim()) return fromHeader.trim();
  const auth = req.headers.authorization;
  const authStr = Array.isArray(auth) ? auth[0] : auth;
  if (typeof authStr === "string") {
    const m = /^Bearer\s+(.+)$/i.exec(authStr.trim());
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return undefined;
}

export function enforceMutatingApiAuth(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  sendJson: (res: ServerResponse, code: number, body: unknown) => void,
): boolean {
  const expected = configuredApiKey();
  if (!expected) return true;
  if (!pathname.startsWith("/api/")) return true;
  if (!isMutatingMethod(req.method)) return true;
  const presented = extractApiKey(req);
  if (!presented || !keysMatch(presented, expected)) {
    sendJson(res, 401, { error: "unauthorized" });
    return false;
  }
  return true;
}
