# durabl — 5-minute demo script

**Audience:** Investors or design partners · **Runtime:** ~5 minutes · **Prereqs:** Node ≥ 22.5, `npm install && npm run build` once

**Commands referenced:**

| Mode | Command | UX |
|---|---|---|
| Continuous (CI, rehearsal) | `npm run demo` | No pauses; ~4–5 min wall clock |
| **Paced (live room)** | `npm run demo:interactive` or `bash scripts/demo-interactive.sh` | Enter between acts; narrator cues on screen |

Set `DURABL_DEMO_PAUSE=1` (and optional `DURABL_DEMO_NARRATE=0` to hide cues) to pace `npm run demo` yourself.

---

## Interactive UX timing (paced mode)

Presenter cues and target segment lengths are embedded in `src/harness/demo.ts` (`NARRATION`); keep this table aligned when editing the script.

| Pause point | Target | On-screen cue theme |
|---|---|---|
| Before Act 1 | 0:15 | Real Restate + real SIGKILL |
| After SIGKILL `true` | +0:10 | **Hook** — silence until Enter |
| Before Act 2 | 0:45 | Exactly-once, effect count = 1 |
| Before Act 3 | 0:30 | Portable journal rows |
| Before Act 4 | 1:00 | Fork prefix, no re-fire |
| Before Act 5 | 0:45 | Diff + JSONL export |
| Verdict | 0:30 | Q&A buffer |

**Wall clock with pauses:** plan **6–8 minutes** (audience questions during Enter waits are normal).

---

## Setup (before room / call)

```bash
cd /path/to/durabl-fundability   # feat/fundability worktree
npm install
npm run build
# Optional: terminal with larger font; second terminal for Acts 6–8
```

**Talking point while loading:** “Everything you’ll see uses a real Restate server and a real SIGKILL — no mocked crash recovery.”

---

## Act 1 — Kill the agent (0:00–1:15) · `npm run demo`

**Run:**

```bash
npm run demo
```

**On screen:** Banner `ACT 1 — Kill an agent mid-run…`

**Say:** “We start a three-step agent run. Mid-flight we kill the process at the worst moment — right after a side effect fired but before the journal committed. That’s the classic double-charge bug.”

**Kill moment (speaker note):** Pause when the script prints `service really died (uncatchable SIGKILL): true`. Let the room feel the silence — **this is the hook**.

**Say:** “Uncatchable SIGKILL. Not a graceful shutdown. If durability is fake, we’d see two tool calls in the effect ledger.”

---

## Act 2 — Resume exactly once (1:15–2:00)

**On screen:** `ACT 2 — Resume from the exact step. Exactly-once preserved.`

**Say:** “We restart the service. Restate replays the workflow; our journal short-circuits completed steps. The effect sink shows **fire count = 1** — read from the real SQLite effect DB, not a slide.”

**Point at:** `EXACTLY-ONCE across crash: YES ✓`

**Investor line:** “M1 is structural: every side effect requires a deterministic idempotency key `runId:stepName`. Types enforce it.”

---

## Act 3 — Open the portable journal (2:00–2:30)

**On screen:** `ACT 3 — Open the trajectory from the portable journal.`

**Say:** “This is the asset we’re productizing — a portable step journal: plan → tool (side effect) → summarize. Each row is replayable state, not a log line.”

---

## Act 4 — Fork without re-firing the prefix (2:30–3:30)

**On screen:** `ACT 4 — Fork from an earlier step onto an alternate path.`

**Say:** “What if we’d decided differently **before** the tool call? We seed a new run from sequence 1 — copied journal prefix, **no re-execution** of the expensive steps. The fork makes its **own** tool call with a new prompt.”

**Investor line:** “Logical fork, not CRIU snapshot. Same model Google ships as `ax fork` — we’re not claiming invention; we’re claiming **portable, neutral DX** on top of a substrate you can swap.”

---

## Act 5 — Diff + export (3:30–4:15)

**On screen:** `ACT 5 — Compare the two trajectories. Prove no cross-fire.`

**Say:** “Original run still has one effect. Fork has one effect. Diff shows first divergence. The JSONL export at the end is the portability wedge — lineage travels with the bundle.”

**On screen:** `DEMO PASSED — this is the single demo that proves the company.`

**Wrap Acts 1–5:** “That’s crash safety plus counterfactual branching in one script. Gates run this in CI with real SIGKILL.”

---

## Act 6 — Offline replay (optional, +45s)

**Prep:** Note `DURABL_DATA_DIR` from demo (default under `$TMPDIR/durabl-m1`) or re-use fork run id from Act 5 output.

```bash
# Terminal 2 — service can be stopped; demo already killed processes
export DURABL_DATA_DIR="${TMPDIR:-/tmp}/durabl-m1"
node dist/cli.js export-bundle <forkRunId> > /tmp/run-bundle.jsonl

# Kill any restate if still up (proves offline)
pkill -9 -f restate-server || true

node dist/cli.js replay <forkRunId> --from /tmp/run-bundle.jsonl
node dist/cli.js state-at <forkRunId> --n 2 --from /tmp/run-bundle.jsonl
```

**Say:** “Substrate is dead. Reconstruction is identical — same code path as live, only reads the export. This is M3.”

**Optional UI (30s):**

```bash
node dist/cli.js ui --from /tmp/run-bundle.jsonl
# Open http://127.0.0.1:7878 — scrub timeline, fork tree, diff
```

---

## Act 7 — HITL across process restart (optional, +60s)

**Requires:** Restate + service running (restart after offline act).

```bash
# Terminal 1
npm run service

# Terminal 2 — start restate if needed (see harness/restate-control.ts or npm test preamble)
RUN_ID="hitl-demo-$(date +%s)"
node dist/cli.js hitl-run "$RUN_ID" --prompt "approve wire transfer"
sleep 2
node dist/cli.js hitl-status "$RUN_ID"    # expect paused

# Kill the service process (Ctrl-C or pkill dist/service.js) — run stays suspended in Restate
# Restart service + restate, re-register deployment (npm run gate:m5 does this; or quick restart)

node dist/cli.js hitl-input "$RUN_ID" --decision "approved with limit 10k"
node dist/cli.js inspect "$RUN_ID"
```

**Say:** “Human approval is a durable journal step, not an in-memory await. Process died; run still paused; resume is exactly-once. M5 gate proves SIGKILL during resume too.”

**Shortcut for due diligence:** `npm run gate:m5` — full adversarial evidence in [`docs/m5-evidence/`](m5-evidence/).

---

## Act 8 — Neutrality one-liner (optional, 15s)

**Say:** “Same workflow, switch `DURABL_MODEL_PROVIDER=fake-echo` vs `fake-upper` or wire real OpenAI/Anthropic keys — no code change. Docker deploy target is config-ready when daemon present. See `docs/m4-neutrality.md`.”

---

## Timing cheat sheet

| Segment | Continuous (`npm run demo`) | Paced (`npm run demo:interactive`) |
|---|---|---|
| Acts 1–2 (kill + resume) | 2:00 | 2:30 (+ hook pause) |
| Acts 3–5 (journal + fork + diff) | 2:15 | 3:00 (+ Enter between acts) |
| Verdict + Q&A buffer | 0:45 | 1:00–2:00 |
| Acts 6–8 (if live) | +2:00 (separate “deep dive”) | same |

---

## Failure recovery (live demo)

| Symptom | Fix |
|---|---|
| `restate-server failed to become healthy` | `pkill -9 -f restate-server`; rm restate data dir; retry |
| `DEMO FAILED` effect count ≠ 1 | Stale data — `rm -rf $TMPDIR/durabl-m1` and rerun |
| Port 8080/9080 in use | Set `DURABL_SERVICE_PORT` / stop conflicting services |

---

## Evidence pointers

- Demo source: `src/harness/demo.ts`
- Interactive driver: `scripts/demo-interactive.sh` · `npm run demo:interactive`
- M1 crash gates: `npm test`
- Full milestone table: [`docs/build-status.md`](build-status.md)
- Fundability framing: [`docs/FUNDING.md`](FUNDING.md)
