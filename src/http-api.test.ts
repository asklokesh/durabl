import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { FIXTURE_HITL_UI_OFFLINE } from "./harness/fixture-paths.js";
import { startServerHandle, type ServerHandle } from "./server.js";

describe("http API (offline import)", () => {
  let ui: ServerHandle;

  before(async () => {
    ui = await startServerHandle({ importPath: FIXTURE_HITL_UI_OFFLINE, port: 18788 });
  });

  after(async () => {
    await ui.close();
  });

  it("GET /health returns ok", async () => {
    const res = await fetch(`${ui.url}/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean };
    assert.equal(body.ok, true);
  });

  it("GET /api/health includes hitlSubmitEnabled false offline", async () => {
    const res = await fetch(`${ui.url}/api/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { hitlSubmitEnabled: boolean; live: boolean };
    assert.equal(body.live, false);
    assert.equal(body.hitlSubmitEnabled, false);
  });

  it("POST /api/hitl/input returns 503 offline", async () => {
    const res = await fetch(`${ui.url}/api/hitl/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "offline-run", decision: "approve" }),
    });
    assert.equal(res.status, 503);
    const body = (await res.json()) as { submitEnabled: boolean };
    assert.equal(body.submitEnabled, false);
  });

  it("GET /ready succeeds in offline mode", async () => {
    const res = await fetch(`${ui.url}/ready`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ready: boolean };
    assert.equal(body.ready, true);
  });
});
