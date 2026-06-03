// HTTP API smoke tests — offline export mode (no Restate / SQLite required).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { closeOfflineHitlQueueForTests } from "../dist/hitl-offline-queue.js";
import { startServerHandle, type ServerHandle } from "../dist/server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OFFLINE_FIXTURE = join(
  __dirname,
  "..",
  "test/fixtures/hitl-ui-offline-paused.jsonl",
);
const OFFLINE_RUN_ID = "hitl-ui-offline-paused";

let ui: ServerHandle | null = null;
let dataDir: string;
const prevDataDir = process.env.DURABL_DATA_DIR;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "durabl-tests-api-"));
  process.env.DURABL_DATA_DIR = dataDir;
  closeOfflineHitlQueueForTests();
  ui = await startServerHandle({ importPath: OFFLINE_FIXTURE, port: 17879 });
});

after(async () => {
  if (ui) await ui.close();
  closeOfflineHitlQueueForTests();
  rmSync(dataDir, { recursive: true, force: true });
  if (prevDataDir === undefined) delete process.env.DURABL_DATA_DIR;
  else process.env.DURABL_DATA_DIR = prevDataDir;
});

test("GET /api/health — offline import with queue", async () => {
  assert.ok(ui);
  const res = await fetch(`${ui.url}/api/health`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    ok?: boolean;
    live?: boolean;
    hitlSubmitEnabled?: boolean;
    hitlSubmitMode?: string;
    origin?: string;
  };
  assert.equal(body.ok, true);
  assert.equal(body.live, false);
  assert.equal(body.hitlSubmitEnabled, true);
  assert.equal(body.hitlSubmitMode, "offline-queue");
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
  assert.equal(body.submitEnabled, true);
  assert.equal(body.live, false);
  assert.ok(body.paused?.some((p) => p.runId === OFFLINE_RUN_ID));
});

test("POST /api/hitl/input — queues decision offline", async () => {
  assert.ok(ui);
  const res = await fetch(`${ui.url}/api/hitl/input`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId: OFFLINE_RUN_ID, decision: "APPROVED-OFFLINE-TEST" }),
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
});
