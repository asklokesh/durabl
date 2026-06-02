// SECURITY-REVIEW: optional API key gate and CORS allowlist for local UI server.

import type { IncomingMessage, ServerResponse } from "node:http";

const API_KEY = process.env.DURABL_API_KEY?.trim() || "";

function corsOrigins(): string[] | null {
  const raw = process.env.DURABL_CORS_ORIGINS?.trim();
  if (!raw) return null;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function applySecurityHeaders(res: ServerResponse): void {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
}

export function applyCors(req: IncomingMessage, res: ServerResponse): boolean {
  const origins = corsOrigins();
  if (!origins) return true;
  const origin = req.headers.origin;
  if (!origin || !origins.includes(origin)) {
    if (req.method === "OPTIONS") {
      res.writeHead(403);
      res.end();
      return false;
    }
    return true;
  }
  res.setHeader("access-control-allow-origin", origin);
  res.setHeader("vary", "Origin");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return false;
  }
  return true;
}

export function requireApiKeyIfConfigured(
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  if (!API_KEY) return true;
  const auth = req.headers.authorization;
  const bearer =
    typeof auth === "string" && auth.startsWith("Bearer ")
      ? auth.slice(7).trim()
      : "";
  const header = req.headers["x-durabl-api-key"];
  const fromHeader = typeof header === "string" ? header.trim() : "";
  if (bearer === API_KEY || fromHeader === API_KEY) return true;
  res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "unauthorized" }));
  return false;
}

export function isMutatingApiMethod(method: string | undefined): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}
