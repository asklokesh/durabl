// HTTP API smoke tests — offline export mode (no Restate / SQLite required).
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { startServerHandle, type ServerHandle } from "../dist/server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OFFLINE_FIXTURE = join(
  __dirname,
  "..",
  "test/fixtures/hitl-ui-offline-paused.jsonl",
);
const OFFLINE_RUN_ID = "hitl-ui-offline-paused";

let ui: ServerHandle | null = null;

test.before(async () => {
  ui = await startServerHandle({ importPath: OFFLINE_FIXTURE, port: 17879 });
});

after(async () => {
  if (ui) await ui.close();
});

test("GET /api/health — offline import", async () => {
  assert.ok(ui);
  const res = await fetch(`${ui.url}/api/health`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    ok?: boolean;
    live?: boolean;
    hitlSubmitEnabled?: boolean;
    origin?: string;
  };
  assert.equal(body.ok, true);
  assert.equal(body.live, false);
  assert.equal(body.hitlSubmitEnabled, false);
  assert.match(body.origin ?? "", /imported/);
});

test("GET /api/hitl/paused — lists paused run from export", async () => {
  assert.ok(ui);
  const res = await fetch(`${ui.url}/api/hitl/paused`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    submitEnabled?: boolean;
    live?: boolean;
    paused?: { runId: string }[];
  };
  assert.equal(body.submitEnabled, false);
  assert.equal(body.live, false);
  assert.ok(body.paused?.some((p) => p.runId === OFFLINE_RUN_ID));
});

test("POST /api/hitl/input — 503 when offline (HITL submit disabled)", async () => {
  assert.ok(ui);
  const res = await fetch(`${ui.url}/api/hitl/input`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId: OFFLINE_RUN_ID, decision: "SHOULD-FAIL" }),
  });
  assert.equal(res.status, 503);
  const body = (await res.json()) as { submitEnabled?: boolean; error?: string };
  assert.equal(body.submitEnabled, false);
  assert.match(body.error ?? "", /live mode/i);
});
