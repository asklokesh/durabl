import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  closeOfflineHitlQueueForTests,
  enqueueOfflineHitl,
  exportKeyForOrigin,
  listQueuedHitl,
  validateHitlDecision,
  validateHitlRunId,
} from "./hitl-offline-queue.js";

describe("hitl-offline-queue", () => {
  let dataDir: string;
  const prev = process.env.DURABL_DATA_DIR;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "durabl-hitl-q-"));
    process.env.DURABL_DATA_DIR = dataDir;
    closeOfflineHitlQueueForTests();
  });

  afterEach(() => {
    closeOfflineHitlQueueForTests();
    rmSync(dataDir, { recursive: true, force: true });
    if (prev === undefined) delete process.env.DURABL_DATA_DIR;
    else process.env.DURABL_DATA_DIR = prev;
  });

  it("validates runId and decision", () => {
    assert.equal(validateHitlRunId("../x"), "invalid runId");
    assert.equal(validateHitlDecision(""), "decision required");
  });

  it("enqueues and lists by export key", () => {
    const key = exportKeyForOrigin("imported:/tmp/foo.jsonl");
    enqueueOfflineHitl(key, "run-a", "APPROVED");
    const rows = listQueuedHitl(key);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.runId, "run-a");
    assert.equal(rows[0]!.decision, "APPROVED");
  });

  it("isolates partitions by export key", () => {
    enqueueOfflineHitl(exportKeyForOrigin("a"), "run-1", "yes");
    enqueueOfflineHitl(exportKeyForOrigin("b"), "run-1", "no");
    assert.equal(listQueuedHitl(exportKeyForOrigin("a")).length, 1);
    assert.equal(listQueuedHitl(exportKeyForOrigin("b"))[0]!.decision, "no");
  });
});
