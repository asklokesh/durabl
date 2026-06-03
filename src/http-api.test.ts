import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE_HITL_UI_OFFLINE } from "./harness/fixture-paths.js";
import { closeOfflineHitlQueueForTests } from "./hitl-offline-queue.js";
import { startServerHandle, type ServerHandle } from "./server.js";

const OFFLINE_RUN = "hitl-ui-offline-paused";

describe("http API (offline import)", () => {
  let ui: ServerHandle;
  let dataDir: string;
  const prevDataDir = process.env.DURABL_DATA_DIR;

  before(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "durabl-api-hitl-"));
    process.env.DURABL_DATA_DIR = dataDir;
    closeOfflineHitlQueueForTests();
    ui = await startServerHandle({ importPath: FIXTURE_HITL_UI_OFFLINE, port: 18788 });
  });

  after(async () => {
    await ui.close();
    closeOfflineHitlQueueForTests();
    rmSync(dataDir, { recursive: true, force: true });
    if (prevDataDir === undefined) delete process.env.DURABL_DATA_DIR;
    else process.env.DURABL_DATA_DIR = prevDataDir;
  });

  it("GET /health returns ok", async () => {
    const res = await fetch(`${ui.url}/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean };
    assert.equal(body.ok, true);
  });

  it("GET /api/health enables offline HITL queue", async () => {
    const res = await fetch(`${ui.url}/api/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      hitlSubmitEnabled: boolean;
      live: boolean;
      hitlSubmitMode?: string;
    };
    assert.equal(body.live, false);
    assert.equal(body.hitlSubmitEnabled, true);
    assert.equal(body.hitlSubmitMode, "offline-queue");
  });

  it("POST /api/hitl/input queues decision offline", async () => {
    const res = await fetch(`${ui.url}/api/hitl/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: OFFLINE_RUN, decision: "APPROVED-OFFLINE" }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      queued?: boolean;
      accepted?: boolean;
      state?: string;
    };
    assert.equal(body.queued, true);
    assert.equal(body.accepted, true);
    assert.equal(body.state, "resumed");

    const pausedRes = await fetch(`${ui.url}/api/hitl/paused`).then((r) => r.json()) as {
      paused?: { runId: string }[];
    };
    assert.equal(
      pausedRes.paused?.some((p) => p.runId === OFFLINE_RUN),
      false,
    );
  });

  it("POST /api/hitl/input rejects invalid runId", async () => {
    const res = await fetch(`${ui.url}/api/hitl/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "../x", decision: "nope" }),
    });
    assert.equal(res.status, 400);
  });

  it("GET /ready succeeds in offline mode", async () => {
    const res = await fetch(`${ui.url}/ready`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ready: boolean };
    assert.equal(body.ready, true);
  });
});
