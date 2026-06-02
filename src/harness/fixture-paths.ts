import { join } from "node:path";

/** Committed stable JSONL bundles for offline replay and UI tests. */
export const FIXTURES_DIR = join(process.cwd(), "test", "fixtures");

export const FIXTURE_M3_PORTABLE = join(FIXTURES_DIR, "m3-portable-bundle.jsonl");
export const FIXTURE_M5_HITL = join(FIXTURES_DIR, "m5-hitl-run-bundle.jsonl");
export const FIXTURE_HITL_UI_OFFLINE = join(FIXTURES_DIR, "hitl-ui-offline-paused.jsonl");
