# durabl — Test matrix

**Date:** 2026-06-01 · Single-machine envelope (real SIGKILL + process restart on crash paths).

| Command | Scope | Pass bar | Keys / deps | CI default |
|---|---|---|---|---|
| `npm test` (`gate`) | M1 — journal + exactly-once | 10/10 | Node ≥ 22.5, local `restate-server` | **required** |
| `npm run gate:m2` | M2 — logical fork + inspect | 6/6 | same | **required** |
| `npm run gate:m3` | M3 — replay + offline export + UI APIs | 5/5 | same; browse capture optional | **required** |
| `npm run gate:m4` | M4 — provider + deploy neutrality | 4/4 | Docker image optional (CONFIG-READY-NOT-RUN) | **required** |
| `npm run gate:m5` | M5 — HITL pause/resume + export | 4/4 | same | **required** |
| `npm run gate:live` | Live LLM providers | 1 per key present | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and/or `OPENROUTER_API_KEY` | **skip (exit 0)** if no keys |
| `npm run gate:hitl-web` | HITL web UI + `/api/hitl/*` | 3/3 | same as M5 | **required** |
| `npm run demo` | Scripted M1+M2 narrative | completes | same | manual / smoke |
| `npm run typecheck` | TypeScript | 0 errors | none | optional pre-PR |

**Run all required gates:**

```bash
npm test && npm run gate:m2 && npm run gate:m3 && npm run gate:m4 && npm run gate:m5
```

**Optional (when keys available):**

```bash
npm run gate:live
```

---

## What each gate proves (one line)

- **M1** — exactly-once across real SIGKILL at every boundary + fork-no-refire on replay paths.
- **M2** — logical trajectory fork without side-effect re-fire; crash-during-fork safe.
- **M3** — offline reconstruction from JSONL with substrate killed; UI read APIs work offline.
- **M4** — switch model provider and deploy target by config only; journal portable.
- **M5** — HITL pause durable in journal; resume after full process kill; export replayable offline.
- **live** — real HTTP completion journaled + replayed when API keys set.
- **hitl-web** — paused runs listed in UI API; live submit resumes run; offline submit blocked.

---

## Evidence directories

| Gate | Log / artifacts |
|---|---|
| M1 | `docs/m1-evidence/gate-evidence.log` |
| M2 | `docs/m2-evidence/` |
| M3 | `docs/m3-evidence/gate-evidence.log` (+ gitignored `portable-bundle.jsonl`, `screenshots/` from gate / `capture:ui`) |
| M4 | `docs/m4-evidence/gate-evidence.log` |
| M5 | stdout gate transcript (+ gitignored `docs/m5-evidence/hitl-run-bundle.jsonl` from gate) |
| hitl-web | `docs/hitl-ui-evidence/hitl-ui-offline.jsonl` (pinned fixture; see README there) |
| live | stdout only (no network without keys) |
| hitl-web | stdout + pinned fixture under `docs/hitl-ui-evidence/` |

See [`docs/HARDENING.md`](HARDENING.md) for provider HTTP policy and skip semantics.
