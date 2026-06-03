# durabl — FAQ

Short answers grounded in the shipped docs and gates on `main`. For ops-style
fixes, see [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).

---

### 1. What is durabl?

A neutral, self-hostable **agent execution journal** with replay/time-travel,
logical step-level fork (no CRIU), and human-in-the-loop pause/resume. Restate
provides crash-durable steps; durabl owns the portable journal, structural
exactly-once effects, fork semantics, and offline replay UI.
([`README.md`](../README.md), [`ARCHITECTURE.md`](ARCHITECTURE.md))

### 2. How do I install durabl?

v0.1.0 is **not** on npmjs.org (`npm install durabl` → 404). Use one of:

- **Release tarball:** download `durabl-<version>.tgz` from the GitHub Actions run
  for tag `v*`, then `npm install /path/to/durabl-0.1.0.tgz` ([`RELEASING.md`](RELEASING.md))
- **From source:** `git clone https://github.com/asklokesh/durabl.git`, `npm install`,
  `npm run build` ([`README.md`](../README.md#install))

### 3. What do I need installed (runtime)?

**Node.js >= 22.5.0** (uses built-in `node:sqlite`). macOS or Linux recommended
for adversarial harness gates. Docker is **optional** (native `restate-server` is
the default path).
([`README.md`](../README.md#quickstart))

### 4. How do I verify everything works?

```bash
npm install
npm run build   # optional; tests build automatically
npm test        # M1 gate (== npm run gate:m1)
```

Milestone gates: `npm run gate:m2` … `gate:m5`, `gate:hitl-ui`, serial
`npm run gate:all`. Matrix: [`TEST-MATRIX.md`](TEST-MATRIX.md),
[`build-status.md`](build-status.md).

### 5. Does durabl use process snapshots (CRIU)?

**No.** Durability is **journal records + structural per-step idempotency** only.
Forking copies journal state logically; side effects do not re-fire on replay
paths. ([`m1-slice.md`](m1-slice.md), Phase 0 redline in
[`phase0/prd-redline.md`](phase0/prd-redline.md))

### 6. Can I replay runs with Restate stopped?

**Yes.** Export JSONL (`export-bundle`, `exportJsonlWithEffects`) and replay via
`durabl ui --from export.jsonl` or `reconstruct()` over `importJournalSource()`.
The M3 gate kills the substrate and proves byte-identical offline replay.
([`m3-observability-replay.md`](m3-observability-replay.md))

### 7. What is “logical fork”?

A new run branch seeded from a parent journal prefix; downstream steps can
diverge while completed prefix steps replay from the journal without re-firing
effects. APIs: `forkRun`, `forkTree`, `diffTrajectories`. Gate: `npm run gate:m2`.
([`m2-trajectory-branching.md`](m2-trajectory-branching.md))

### 8. How does HITL pause/resume work?

A Restate workflow hits a durable pause (`hitl_pause` in the journal); humans
supply input via CLI `hitl-input` or live UI `POST /api/hitl/input`, which calls
Restate `provideInput`. Resume survives a **real** process/substrate restart;
exactly-once is unchanged from M1. ([`m5-hitl-export.md`](m5-hitl-export.md),
[`hitl-web-ui.md`](hitl-web-ui.md))

### 9. Why can’t I submit HITL input from an offline export?

Offline mode only has the **journal read path**. Submitting input must resolve a
**durable promise** on live Restate ingress — the API returns **503** with an
explicit error. Listing paused runs from export still works.
([`hitl-web-ui.md`](hitl-web-ui.md), [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md#offline-hitl-post-apihitlinput-returns-503))

### 10. Can I switch model provider or deploy target without code changes?

**Yes (M4).** Set `DURABL_MODEL_PROVIDER` and `DURABL_DEPLOY_TARGET` (`local` |
`docker` | `external`). Same agent loop and journal portability across switches.
([`m4-neutrality.md`](m4-neutrality.md), [`.env.example`](../.env.example))

### 11. Why do gates fail when I run two checkouts at once?

Gates share `/tmp/durabl-harness.lock` (unless `DURABL_HARNESS_LOCK` is set) and
localhost ports **8080, 9070, 9080, 7879, 17878, 17879**. Parallel gate runs
race and look like product bugs. Run **one gate at a time** across worktrees.
([`DEVELOPMENT.md`](DEVELOPMENT.md#harness-lock-file),
[`TROUBLESHOOTING.md`](TROUBLESHOOTING.md))
