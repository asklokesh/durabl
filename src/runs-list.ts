// Paginated run listing for GET /api/runs (ui-run-list + large journals).

import {
  countRuns as liveCountRuns,
  decodeRunListCursor,
  encodeRunListCursor,
  listRunMetaPage as liveListRunMetaPage,
  rootRunIds as liveRootRunIds,
  stepCount as liveStepCount,
} from "./journal.js";
import type { JournalSource } from "./journal-source.js";
import { hitlStateFromSource } from "./hitl-source.js";
import type { HitlState } from "./journal.js";
import type { RunMeta } from "./step-model.js";

/** One row in GET /api/runs — matches the replay UI run list contract. */
export interface ApiRunRow {
  readonly runId: string;
  readonly trajectory: string;
  readonly parentRun: string | null;
  readonly forkedAtSeq: number | null;
  readonly steps: number;
  readonly createdAt: string;
  readonly hitlState: HitlState;
}

export interface RunsListQuery {
  readonly limit?: number;
  readonly cursor?: string;
}

export interface RunsListResult {
  readonly runs: ApiRunRow[];
  readonly roots: string[];
  readonly nextCursor: string | null;
  readonly total?: number;
  readonly limit?: number;
}

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 500;

export function parseRunsListQuery(
  limitParam: string | null,
  cursorParam: string | null,
): RunsListQuery | { error: string } {
  const paginate = limitParam !== null || cursorParam !== null;
  if (!paginate) return {};

  let limit = DEFAULT_PAGE_LIMIT;
  if (limitParam !== null && limitParam !== "") {
    const n = Number(limitParam);
    if (!Number.isInteger(n) || n < 1) return { error: "limit must be a positive integer" };
    limit = Math.min(n, MAX_PAGE_LIMIT);
  }

  const cursor = cursorParam?.trim() || undefined;
  if (cursor !== undefined && cursor === "") return { error: "cursor must be non-empty when provided" };

  return { limit, cursor };
}

function stepCountFor(source: JournalSource, runId: string): number {
  if (source.origin === "live-sqlite-journal") return liveStepCount(runId);
  return source.trajectory(runId).length;
}

function toApiRow(source: JournalSource, m: RunMeta): ApiRunRow {
  return {
    runId: m.runId,
    trajectory: m.trajectory,
    parentRun: m.parentRun,
    forkedAtSeq: m.forkedAtSeq,
    steps: stepCountFor(source, m.runId),
    createdAt: m.createdAt,
    hitlState: hitlStateFromSource(source, m.runId),
  };
}

function rootIdsFromSource(source: JournalSource): string[] {
  if (source.origin === "live-sqlite-journal") return liveRootRunIds();
  return source
    .allRunIds()
    .filter((id) => (source.runMeta(id)?.parentRun ?? null) === null);
}

function listMetasPage(
  source: JournalSource,
  limit: number,
  cursor?: string,
): { items: RunMeta[]; nextCursor: string | null } {
  if (source.origin === "live-sqlite-journal") {
    return liveListRunMetaPage(limit, cursor);
  }

  const ordered = source
    .allRunIds()
    .map((id) => source.runMeta(id))
    .filter((m): m is RunMeta => m !== undefined);

  let start = 0;
  if (cursor) {
    const decoded = decodeRunListCursor(cursor);
    if (!decoded) throw new Error("invalid cursor");
    const idx = ordered.findIndex(
      (m) => m.createdAt === decoded.createdAt && m.runId === decoded.runId,
    );
    if (idx < 0) throw new Error("cursor not found");
    start = idx + 1;
  }

  const slice = ordered.slice(start, start + limit + 1);
  const hasMore = slice.length > limit;
  const items = hasMore ? slice.slice(0, limit) : slice;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? encodeRunListCursor(last) : null,
  };
}

function totalRuns(source: JournalSource): number {
  if (source.origin === "live-sqlite-journal") return liveCountRuns();
  return source.allRunIds().length;
}

/** Build the GET /api/runs payload (full list or cursor page). */
export function listRunsForApi(
  source: JournalSource,
  query: RunsListQuery,
): RunsListResult {
  const roots = rootIdsFromSource(source);

  if (query.limit === undefined && query.cursor === undefined) {
    const runs = source
      .allRunIds()
      .map((id) => source.runMeta(id))
      .filter((m): m is RunMeta => m !== undefined)
      .map((m) => toApiRow(source, m));
    return { runs, roots, nextCursor: null };
  }

  const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
  const page = listMetasPage(source, limit, query.cursor);
  return {
    runs: page.items.map((m) => toApiRow(source, m)),
    roots,
    nextCursor: page.nextCursor,
    total: totalRuns(source),
    limit,
  };
}
