// SECURITY-REVIEW: in-memory rate limit on HITL submit; per-runId token bucket.

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;

const buckets = new Map<string, { count: number; resetAt: number }>();

export function allowHitlInputSubmit(runId: string): boolean {
  const now = Date.now();
  const cur = buckets.get(runId);
  if (!cur || now >= cur.resetAt) {
    buckets.set(runId, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (cur.count >= MAX_PER_WINDOW) return false;
  cur.count += 1;
  return true;
}
