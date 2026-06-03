import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FIXTURE_M3_PORTABLE } from "./harness/fixture-paths.js";
import { importJournalSource } from "./journal-source.js";
import {
  dbosJournalSourceFromPath,
  dbosJournalSourceStub,
  dbosExportJournalSourceAvailable,
  dbosJournalSource,
} from "./journal-source-dbos-stub.js";
import { compareSources } from "./replay.js";

const ROOT_RUN = "m3-root-1780353444814";

describe("dbos journal source (file export)", () => {
  it("dbosExportJournalSourceAvailable is true for committed fixture", () => {
    assert.equal(dbosExportJournalSourceAvailable(FIXTURE_M3_PORTABLE), true);
  });

  it("dbosJournalSourceFromPath matches import replay on root run", () => {
    const jsonl = readFileSync(FIXTURE_M3_PORTABLE, "utf8");
    const imp = importJournalSource(jsonl, "imported:test");
    const dbos = dbosJournalSourceFromPath(FIXTURE_M3_PORTABLE, {
      exportPath: FIXTURE_M3_PORTABLE,
      workflowName: "TestWorkflow",
    });
    assert.ok(dbos.origin.includes("workflow=TestWorkflow"));
    const div = compareSources(imp, dbos, ROOT_RUN);
    assert.equal(div.identical, true, div.differences.join("; "));
  });

  it("dbosJournalSource uses export when DBOS_JOURNAL_EXPORT is set", () => {
    const prev = process.env.DBOS_JOURNAL_EXPORT;
    process.env.DBOS_JOURNAL_EXPORT = FIXTURE_M3_PORTABLE;
    try {
      const src = dbosJournalSource({ workflowName: "EnvRun" });
      assert.ok(src.origin.startsWith("dbos-journal("));
      assert.equal(src.trajectory(ROOT_RUN).length, 3);
    } finally {
      if (prev === undefined) delete process.env.DBOS_JOURNAL_EXPORT;
      else process.env.DBOS_JOURNAL_EXPORT = prev;
    }
  });

  it("dbosJournalSourceStub throws on trajectory", () => {
    const stub = dbosJournalSourceStub();
    assert.throws(() => stub.trajectory("x"), /not implemented/i);
  });
});
