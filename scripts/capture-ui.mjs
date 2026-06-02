// ─────────────────────────────────────────────────────────────────────────────
// capture-ui.mjs — standalone screenshot capturer for the durabl replay UI.
//
//   node scripts/capture-ui.mjs [bundle.jsonl] [outDir] [port]
//
// Launches the replay UI server (as a child process) over a portable JSONL
// export (OFFLINE — no substrate), drives gstack browse headlessly, and saves
// screenshots. Runs as its OWN process so the browse daemon is not driven from
// the server's event loop (which deadlocked when co-located). Exits non-zero
// on failure.
//
// With no args, captures both M3 replay evidence (docs/m3-evidence/ui-*.png)
// and HITL offline paused UI (docs/hitl-ui-evidence/*.png).
//
// Requires: a built dist/ (npm run build) and the gstack browse binary.
// ─────────────────────────────────────────────────────────────────────────────
import { spawn, spawnSync } from "node:child_process";
import { existsSync, statSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(join(import.meta.dirname, ".."));
const BROWSE = process.env.GSTACK_BROWSE ?? join(process.env.HOME ?? "", ".cursor/skills/gstack/browse/dist/browse");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function browse(args, timeout = 30000) {
  const r = spawnSync(BROWSE, args, { encoding: "utf8", timeout });
  return { ok: r.status === 0, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function nonBlank(p) {
  try {
    return existsSync(p) && statSync(p).size > 3000;
  } catch {
    return false;
  }
}

async function waitForHealth(base, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return r.json();
    } catch {
      /* not yet */
    }
    await sleep(250);
  }
  throw new Error(`UI server did not come up at ${base}`);
}

async function waitForSteps(minSteps = 1, timeoutMs = 9000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const p = browse(["js", "document.querySelectorAll('.step').length"]);
    const line = p.out
      .split("\n")
      .map((l) => l.trim())
      .reverse()
      .find((l) => /^[0-9]+$/.test(l));
    if (line && Number(line) >= minSteps) return Number(line);
    await sleep(300);
  }
  return 0;
}

async function captureSession({ bundle, outDir, port, shots, label }) {
  if (!existsSync(bundle)) throw new Error(`bundle not found: ${bundle}`);
  mkdirSync(outDir, { recursive: true });

  const base = `http://127.0.0.1:${port}`;
  const srv = spawn(
    "node",
    ["--enable-source-maps", join(root, "dist", "cli.js"), "ui", "--from", bundle, "--port", String(port)],
    { stdio: "inherit", env: { ...process.env, DURABL_UI_PORT: String(port) } },
  );
  const cleanup = () => {
    try {
      srv.kill("SIGKILL");
    } catch {}
  };
  process.on("exit", cleanup);

  try {
    const health = await waitForHealth(base);
    console.log(`[capture:${label}] UI up at ${base} — source: ${health.label}`);

    browse(["viewport", "1440x900"]);
    const g = browse(["goto", base]);
    console.log(`[capture:${label}] goto: ${g.out.trim()}`);
    browse(["viewport", "1440x900"]);

    const steps = await waitForSteps(1);
    console.log(`[capture:${label}] timeline rendered ${steps} steps`);
    await sleep(500);

    const paths = [];
    for (const shot of shots) {
      if (shot.js) {
        browse(["js", shot.js]);
        await sleep(shot.waitMs ?? 700);
      }
      const p = join(outDir, shot.name);
      browse(["screenshot", p]);
      paths.push(p);
      console.log(`[capture:${label}] ${shot.name} -> ${existsSync(p) ? statSync(p).size + "b" : "MISSING"}`);
    }

    return { steps, paths, ok: paths.every(nonBlank) && steps > 0 };
  } finally {
    cleanup();
    await sleep(300);
  }
}

const M3_SHOTS = [
  { name: "ui-01-timeline.png" },
  {
    name: "ui-02-fork-tree.png",
    js: "document.querySelectorAll('.tree-node.fork')[0]?.click()",
    waitMs: 700,
  },
  {
    name: "ui-03-trajectory-diff.png",
    js: "document.querySelector('.tab[data-tab=\"diff\"]')?.click()",
    waitMs: 800,
  },
  {
    name: "ui-04-time-travel.png",
    js: `(() => {
      document.querySelectorAll('.tree-node.root')[0]?.click();
      const r = document.querySelector('#ttRange');
      if (r) { r.value = 2; r.dispatchEvent(new Event('input')); }
      document.querySelector('.tab[data-tab=\"step\"]')?.click();
    })()`,
    waitMs: 500,
  },
];

const HITL_SHOTS = [
  { name: "hitl-01-offline-paused-sidebar.png" },
  {
    name: "hitl-02-offline-paused-banner.png",
    js: `(() => {
      const item = document.querySelector('.hitl-paused-item');
      if (item) item.click();
    })()`,
    waitMs: 800,
  },
];

async function captureDefault() {
  const m3Bundle = join(root, "docs", "m3-evidence", "portable-bundle.jsonl");
  const hitlBundle = join(root, "docs", "hitl-ui-evidence", "hitl-ui-offline.jsonl");
  const m3Dir = join(root, "docs", "m3-evidence");
  const hitlDir = join(root, "docs", "hitl-ui-evidence");

  const m3 = await captureSession({
    bundle: m3Bundle,
    outDir: m3Dir,
    port: Number(process.env.DURABL_UI_PORT ?? 7890),
    shots: M3_SHOTS,
    label: "m3",
  });

  const hitl = await captureSession({
    bundle: hitlBundle,
    outDir: hitlDir,
    port: Number(process.env.DURABL_UI_PORT_HITL ?? 7891),
    shots: HITL_SHOTS,
    label: "hitl",
  });

  const ok = m3.ok && hitl.ok;
  console.log(
    `[capture] m3 ${m3.paths.filter(nonBlank).length}/${m3.paths.length} ok; ` +
      `hitl ${hitl.paths.filter(nonBlank).length}/${hitl.paths.length} ok; verdict=${ok ? "OK" : "FAIL"}`,
  );
  return ok ? 0 : 1;
}

async function captureSingle() {
  const bundle = process.argv[2] ?? join(root, "docs", "m3-evidence", "portable-bundle.jsonl");
  const outDir = process.argv[3] ?? join(root, "docs", "m3-evidence");
  const port = Number(process.argv[4] ?? process.env.DURABL_UI_PORT ?? 7890);
  const isHitl = bundle.includes("hitl-ui-offline");
  const shots = isHitl ? HITL_SHOTS : M3_SHOTS;

  const r = await captureSession({ bundle, outDir, port, shots, label: "single" });
  console.log(`[capture] ${r.paths.filter(nonBlank).length}/${r.paths.length} screenshots; verdict=${r.ok ? "OK" : "FAIL"}`);
  return r.ok ? 0 : 1;
}

async function main() {
  if (!existsSync(BROWSE)) throw new Error(`gstack browse not found at ${BROWSE}`);
  if (!existsSync(join(root, "dist", "cli.js"))) {
    throw new Error("dist/cli.js missing — run npm run build first");
  }

  const code = process.argv.length <= 2 ? await captureDefault() : await captureSingle();
  process.exit(code);
}

main().catch((e) => {
  console.error("[capture] ERROR:", e.message);
  process.exit(2);
});
