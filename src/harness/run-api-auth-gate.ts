// API auth gate — optional DURABL_API_KEY on mutating /api/* only.
//
//   npm run gate:api-auth
//
//   G1 api-auth-disabled: no env key → POST /api/hitl/input is not 401 (offline 503).
//   G2 api-auth-enforced: key set → POST without key is 401; GET /api/health is 200;
//       POST with Bearer key passes auth (503 offline, not 401).

import { startServerHandle } from "../server.js";
import { FIXTURE_HITL_UI_OFFLINE } from "./fixture-paths.js";

const BUNDLE = FIXTURE_HITL_UI_OFFLINE;
const GATE_KEY = "durabl-gate-api-auth-test-key";

interface GateResult {
  name: string;
  pass: boolean;
  detail: string;
}
const results: GateResult[] = [];
function record(name: string, pass: boolean, detail: string): void {
  results.push({ name, pass, detail });
  console.log(`[GATE ${pass ? "PASS" : "FAIL"}] ${name}\n  ${detail}\n`);
}

async function main(): Promise<void> {
  const prevKey = process.env.DURABL_API_KEY;
  let ui: Awaited<ReturnType<typeof startServerHandle>> | null = null;

  try {
    delete process.env.DURABL_API_KEY;
    ui = await startServerHandle({ importPath: BUNDLE, port: 17880 });
    const base = ui.url;

    const postOpen = await fetch(`${base}/api/hitl/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "hitl-ui-offline-paused", decision: "x" }),
    });
    const openBody = (await postOpen.json()) as { error?: string };
    record(
      "G1 api-auth-disabled",
      postOpen.status !== 401,
      `POST without key -> ${postOpen.status} (expect not 401; got ${openBody.error?.slice(0, 40) ?? "n/a"})`,
    );

    await ui.close();
    ui = null;

    process.env.DURABL_API_KEY = GATE_KEY;
    ui = await startServerHandle({ importPath: BUNDLE, port: 17881 });
    const secured = ui.url;

    const getHealth = await fetch(`${secured}/api/health`);
    const postDenied = await fetch(`${secured}/api/hitl/input`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "hitl-ui-offline-paused", decision: "x" }),
    });
    const deniedBody = (await postDenied.json()) as { error?: string };
    const postAllowed = await fetch(`${secured}/api/hitl/input`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${GATE_KEY}`,
      },
      body: JSON.stringify({ runId: "hitl-ui-offline-paused", decision: "x" }),
    });

    const pass =
      getHealth.status === 200 &&
      postDenied.status === 401 &&
      deniedBody.error === "unauthorized" &&
      postAllowed.status !== 401;

    record(
      "G2 api-auth-enforced",
      pass,
      `GET /api/health=${getHealth.status} POST open=${postDenied.status} body=${deniedBody.error} ` +
        `POST bearer=${postAllowed.status} (expect 200/503, not 401)`,
    );
  } finally {
    if (ui) await ui.close();
    if (prevKey === undefined) delete process.env.DURABL_API_KEY;
    else process.env.DURABL_API_KEY = prevKey;
  }

  console.log("================ API AUTH GATE SUMMARY ================");
  let passed = 0;
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
    if (r.pass) passed++;
  }
  console.log("------------------------------------------------");
  console.log(`${passed}/${results.length} gates passed`);
  const allPass = passed === results.length;
  console.log(`VERDICT: ${allPass ? "GATE PASSED" : "GATE FAILED"}`);
  console.log("================================================");
  process.exitCode = allPass ? 0 : 1;
}

main().catch((e) => {
  console.error("API auth gate error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
