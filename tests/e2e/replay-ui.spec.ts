import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";

const HITL_RUN = "hitl-ui-offline-paused";
const HITL_PORT = 17980;
const repoRoot = join(import.meta.dirname, "..", "..");

test.describe("Replay UI — static export (no Restate)", () => {
  test("health reports offline imported journal", async ({ request }) => {
    const health = await request.get("/api/health").then((r) => r.json());
    expect(health.live).toBe(false);
    expect(health.hitlSubmitEnabled).toBe(false);
    expect(String(health.origin)).toMatch(/^imported:/);
  });

  test("renders fork tree, timeline, and read APIs", async ({ page, request }) => {
    const runs = await request.get("/api/runs").then((r) => r.json());
    expect(runs.runs.length).toBeGreaterThanOrEqual(4);
    const root = runs.roots[0] as string;

    const replay = await request
      .get(`/api/replay?runId=${encodeURIComponent(root)}`)
      .then((r) => r.json());
    expect(replay.steps).toHaveLength(3);
    expect(replay.effects).toHaveLength(1);
    expect(String(replay.reconstructedFrom)).toMatch(/^imported/);

    const tree = await request
      .get(`/api/tree?runId=${encodeURIComponent(root)}`)
      .then((r) => r.json());
    expect(tree.tree.children).toHaveLength(2);
    const forkA = tree.tree.children[0].runId as string;

    const diff = await request
      .get(`/api/diff?a=${encodeURIComponent(root)}&b=${encodeURIComponent(forkA)}`)
      .then((r) => r.json());
    expect(diff.firstDivergenceSeq).toBe(3);

    await page.goto("/");
    await expect(page.locator("#timeline .step")).toHaveCount(3);
    await expect(page.locator("#tree .tree-node")).toHaveCount(4);
  });
});

test.describe("HITL offline — gate:hitl-ui G2 parity (fetch only)", () => {
  let uiProc: ChildProcess | undefined;
  let baseUrl: string;

  test.beforeAll(async () => {
    const bundle = join(repoRoot, "tests/fixtures/hitl-offline-paused.jsonl");
    uiProc = spawn(
      "node",
      ["--enable-source-maps", join(repoRoot, "dist/cli.js"), "ui", "--from", bundle, "--port", String(HITL_PORT)],
      { cwd: repoRoot, stdio: "pipe", env: { ...process.env } },
    );
    baseUrl = `http://127.0.0.1:${HITL_PORT}`;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`${baseUrl}/api/health`);
        if (r.ok) return;
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error("HITL offline UI did not become ready");
  });

  test.afterAll(async () => {
    if (uiProc && !uiProc.killed) uiProc.kill("SIGTERM");
  });

  test("lists paused run and queues POST offline", async ({ request }) => {
    const pausedRes = await request.get(`${baseUrl}/api/hitl/paused`).then((r) => r.json());
    expect(pausedRes.submitEnabled).toBe(true);
    expect(pausedRes.paused?.some((p: { runId: string }) => p.runId === HITL_RUN)).toBe(true);

    const submitRes = await request.post(`${baseUrl}/api/hitl/input`, {
      data: { runId: HITL_RUN, decision: "APPROVED-E2E-OFFLINE" },
    });
    expect(submitRes.status()).toBe(200);
    const body = await submitRes.json();
    expect(body.queued).toBe(true);
    expect(body.state).toBe("resumed");
  });
});
