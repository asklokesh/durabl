// Run the minimal workflow end-to-end against a local restate-server.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../../../dist/config.js";
import { effectsFor } from "../../../dist/effect-sink.js";
import { trajectory } from "../../../dist/journal.js";
import { registerDeployment, sleep, startRestateServer, waitForRestate, waitForService } from "../../../dist/harness/restate-control.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKFLOW_JS = join(__dirname, "workflow.js");

function startMinimalService(dataDir: string): ChildProcess {
  return spawn("node", ["--enable-source-maps", WORKFLOW_JS], {
    env: { ...process.env, DURABL_DATA_DIR: dataDir, DURABL_MINIMAL_SERVE: "1", DURABL_SERVICE_PORT: String(config.servicePort) },
    stdio: ["ignore", "inherit", "inherit"],
  });
}

async function invoke(runId: string, prompt: string): Promise<unknown> {
  const res = await fetch(`${config.restateIngress}/MinimalRun/${runId}/run`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt }),
  });
  if (!res.ok) throw new Error(`invoke ${runId} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

function killAll(): void {
  spawnSync("pkill", ["-9", "-f", "restate-server"]);
  spawnSync("pkill", ["-9", "-f", "examples/minimal-workflow/dist/workflow.js"]);
}

async function main(): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), "durabl-minimal-"));
  process.env.DURABL_DATA_DIR = dataDir;
  killAll(); await sleep(800); rmSync(config.restateDataDir, { recursive: true, force: true });
  const restateProc = startRestateServer();
  if (!(await waitForRestate(60000))) throw new Error("restate-server did not become healthy");
  const svc = startMinimalService(dataDir);
  if (!(await waitForService(15000))) throw new Error("minimal workflow service did not start");
  const reg = registerDeployment();
  if (!reg.ok) throw new Error("deployment register failed: " + reg.out);
  const runId = `minimal-${Date.now()}`;
  const out = (await invoke(runId, "hello-durabl")) as { runId: string; prepared: string; acted: string };
  console.log("runId:", out.runId);
  console.log("prepared:", out.prepared);
  console.log("acted:", out.acted);
  console.log("journal steps:", trajectory(runId).length);
  console.log("effects fired:", effectsFor(runId).length);
  svc.kill("SIGTERM"); restateProc.kill("SIGTERM"); killAll(); rmSync(dataDir, { recursive: true, force: true });
}

main().catch((err) => { console.error(err); process.exit(1); });
