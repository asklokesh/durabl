import { test } from "node:test";
import assert from "node:assert/strict";
import { startServerHandle } from "../dist/server.js";
import { importJournalSource } from "../dist/journal-source.js";

const FIXTURE = [
  '{"record":"run_meta","schema":1,"runId":"root","parentRun":null,"forkedAtSeq":null,"trajectory":"main","createdAt":"2026-01-01T00:00:00.000Z"}',
  '{"record":"run_meta","schema":1,"runId":"fork-a","parentRun":"root","forkedAtSeq":2,"trajectory":"what-if-a","createdAt":"2026-01-01T00:00:01.000Z"}',
  '{"record":"step","schema":1,"runId":"root","seq":1,"stepName":"s1","kind":"plan","idemKey":"root:1","output":{"n":1},"sideEffect":false,"seededFrom":null,"recordedAt":"2026-01-01T00:00:00.000Z"}',
  '{"record":"step","schema":1,"runId":"root","seq":2,"stepName":"s2","kind":"tool_call","idemKey":"root:2","output":{"n":2},"sideEffect":true,"seededFrom":null,"recordedAt":"2026-01-01T00:00:00.100Z"}',
  '{"record":"step","schema":1,"runId":"fork-a","seq":1,"stepName":"s1","kind":"plan","idemKey":"root:1","output":{"n":1},"sideEffect":false,"seededFrom":"root","recordedAt":"2026-01-01T00:00:00.000Z"}',
  '{"record":"step","schema":1,"runId":"fork-a","seq":2,"stepName":"s2","kind":"tool_call","idemKey":"root:2","output":{"n":2},"sideEffect":true,"seededFrom":"root","recordedAt":"2026-01-01T00:00:00.100Z"}',
  '{"record":"step","schema":1,"runId":"fork-a","seq":3,"stepName":"s3","kind":"summarize","idemKey":"fork-a:3","output":{"n":99},"sideEffect":false,"seededFrom":null,"recordedAt":"2026-01-01T00:00:01.000Z"}',
].join("\n");

test("fork/inspect/lineage REST over imported journal", async () => {
  const source = importJournalSource(FIXTURE, "test-fixture");
  const srv = await startServerHandle({ source, port: 0 });
  try {
    const inspectRes = await fetch(`${srv.url}/api/inspect?runId=fork-a`);
    assert.equal(inspectRes.status, 200);
    const inspect = (await inspectRes.json()) as { inspection: { runId: string; seededSeqs: number[] } };
    assert.equal(inspect.inspection.runId, "fork-a");
    assert.deepEqual(inspect.inspection.seededSeqs, [1, 2]);

    const lineageRes = await fetch(`${srv.url}/api/lineage?runId=fork-a`);
    const lineage = (await lineageRes.json()) as { lineage: { runId: string }[] };
    assert.deepEqual(lineage.lineage.map((n) => n.runId), ["root", "fork-a"]);

    const forksRes = await fetch(`${srv.url}/api/forks?runId=root`);
    const forks = (await forksRes.json()) as { forks: { runId: string }[] };
    assert.deepEqual(forks.forks.map((f) => f.runId), ["fork-a"]);

    const forkPost = await fetch(`${srv.url}/api/fork`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceRunId: "root", newRunId: "fork-b", throughSeq: 1, prompt: "x" }),
    });
    assert.equal(forkPost.status, 503);
  } finally {
    await srv.close();
  }
});
