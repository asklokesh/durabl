// ─────────────────────────────────────────────────────────────────────────────
// capture-ui.mjs — standalone screenshot capturer for the durabl replay UI.
//
//   node scripts/capture-ui.mjs [bundle.jsonl] [outDir] [port]
//
// Launches the replay UI server (as a child process) over a portable JSONL
// export (OFFLINE — no substrate), drives gstack browse headlessly, and saves
// timeline / fork-tree / trajectory-diff / time-travel screenshots. Runs as its
// OWN process so the browse daemon is not driven from the server's event loop
// (which deadlocked when co-located). Exits non-zero on failure.
//
// Requires: a built dist/ (npm run build) and the gstack browse binary.
// ─────────────────────────────────────────────────────────────────────────────
import { spawn, spawnSync } from "node:child_process";
import { existsSync, statSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(join(import.meta.dirname, ".."));
const bundle = process.argv[2] ?? join(root, "docs", "m3-evidence", "portable-bundle.jsonl");
const outDir = process.argv[3] ?? join(root, "docs", "m3-evidence", "screenshots");
const port = Number(process.argv[4] ?? process.env.DURABL_UI_PORT ?? 7890);
const BROWSE = process.env.GSTACK_BROWSE ?? join(process.env.HOME ?? "", ".cursor/skills/gstack/browse/dist/browse");
const base = `http://127.0.0.1:${port}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function browse(args, timeout = 30000) {
  const r = spawnSync(BROWSE, args, { encoding: "utf8", timeout });
  return { ok: r.status === 0, out: (r.stdout ?? "") + (r.stderr ?? "") };
}
function nonBlank(p) {
  try { return existsSync(p) && statSync(p).size > 3000; } catch { return false; }
}

async function main() {
  if (!existsSync(bundle)) throw new Error(`bundle not found: ${bundle} (run npm run gate:m3 first)`);
  if (!existsSync(BROWSE)) throw new Error(`gstack browse not found at ${BROWSE}`);
  mkdirSync(outDir, { recursive: true });

  // Launch the UI server as a child process (its own event loop).
  const srv = spawn(
    "node",
    ["--enable-source-maps", join(root, "dist", "cli.js"), "ui", "--from", bundle, "--port", String(port)],
    { stdio: "inherit", env: { ...process.env, DURABL_UI_PORT: String(port) } },
  );
  const cleanup = () => { try { srv.kill("SIGKILL"); } catch {} };
  process.on("exit", cleanup);

  // Wait for the server to answer.
  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) up = true;
    } catch { /* not yet */ }
    if (!up) await sleep(250);
  }
  if (!up) { cleanup(); throw new Error("UI server did not come up"); }
  const health = await (await fetch(`${base}/api/health`)).json();
  console.log(`[capture] UI up at ${base} — source: ${health.label}`);

  // Drive the browser.
  browse(["viewport", "1440x900"]);
  const g = browse(["goto", base]);
  console.log(`[capture] goto: ${g.out.trim()}`);
  browse(["viewport", "1440x900"]);

  // Poll until the timeline renders.
  let steps = 0;
  for (let i = 0; i < 30; i++) {
    const p = browse(["js", "document.querySelectorAll('.step').length"]);
    const line = p.out.split("\n").map((l) => l.trim()).reverse().find((l) => /^[0-9]+$/.test(l));
    if (line && Number(line) > 0) { steps = Number(line); break; }
    await sleep(300);
  }
  console.log(`[capture] timeline rendered ${steps} steps`);
  await sleep(500);

  const shots = [];
  const shoot = (name) => {
    const p = join(outDir, name);
    browse(["screenshot", p]);
    shots.push(p);
    console.log(`[capture] ${name} -> ${existsSync(p) ? statSync(p).size + "b" : "MISSING"}`);
  };

  shoot("01-timeline.png");

  // Click into a fork (shows fork lineage + seeded steps).
  browse(["js", "document.querySelectorAll('.tree-node.fork')[0]?.click()"]);
  await sleep(700);
  shoot("02-fork-tree.png");

  // Trajectory diff tab.
  browse(["js", "document.querySelector('.tab[data-tab=\"diff\"]')?.click()"]);
  await sleep(800);
  shoot("03-trajectory-diff.png");

  // Time-travel: scrub to step 2 on the root run, back to step detail.
  browse(["js", "document.querySelectorAll('.tree-node.root')[0]?.click()"]);
  await sleep(500);
  browse(["js", "(()=>{const r=document.querySelector('#ttRange'); if(r){r.value=2; r.dispatchEvent(new Event('input'));}})()"]);
  browse(["js", "document.querySelector('.tab[data-tab=\"step\"]')?.click()"]);
  await sleep(500);
  shoot("04-time-travel.png");

  cleanup();
  const allGood = shots.every(nonBlank) && steps > 0;
  console.log(`[capture] ${shots.filter(nonBlank).length}/${shots.length} screenshots non-blank; verdict=${allGood ? "OK" : "FAIL"}`);
  process.exit(allGood ? 0 : 1);
}

main().catch((e) => {
  console.error("[capture] ERROR:", e.message);
  process.exit(2);
});
