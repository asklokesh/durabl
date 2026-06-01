# durabl

A neutral, self-hostable **replay / time-travel debugging** product over a
**portable agent execution journal**, built on [Restate](https://restate.dev)
as the step-journal substrate, using **logical step-level fork** (never
CRIU/process snapshot). TypeScript-first.

This repository currently contains **M1 — the thin vertical slice**: the first
production milestone and the durable foundation that M2 (replay/time-travel UI)
and M3 (logical trajectory fork) build on. See `docs/phase0/` for the validation
report, build plan, and the M0 feasibility findings that this milestone realizes.

## What M1 is

A 3-step agent-style workflow with one side-effecting tool call, run on Restate,
persisting to a **portable, substrate-agnostic step journal** with a
**structurally enforced per-step idempotency contract**. The journal + the
idempotency contract are the durable assets; the workflow is a reference loop
that exercises them.

The **core correctness contract** (the hard requirement surfaced by M0): every
side-effecting step fires through a deterministic idempotency key
(`runId:stepName`), so the dual-write double-fire — a crash landing *after the
effect fires but before its result is journaled* — is structurally deduped to
**exactly once**. This is enforced by types, not convention (see
[`docs/m1-slice.md`](docs/m1-slice.md)).

## Layout

Single-package `src/` layout (not a monorepo). A `packages/` split is deferred to
M4, where the Python SDK and a second substrate land and a workspace split earns
its keep. For M1 a flat package keeps the vertical slice legible.

```
src/
  idempotency.ts    # the contract: branded deterministic IdempotencyKey
  step-model.ts     # neutral, substrate-free journal/step types (schema v1)
  journal.ts        # portable SQLite step journal + JSONL export + forkRun
  effect-sink.ts    # idempotent effect sink — REQUIRES an IdempotencyKey
  workflow.ts       # 3-step agent loop on Restate (ctx.run durable steps)
  crash-inject.ts   # test-only: real SIGKILL at a named boundary (no-op in prod)
  service.ts        # Restate SDK service entry point
  index.ts          # public API surface (no substrate detail re-exported)
  config.ts         # env-driven config (no hardcoded secrets/paths)
  harness/
    restate-control.ts  # drive the local restate-server + SDK service
    run-gate.ts         # the adversarial M1 verification gate (npm test)
```

### Clean separation

- **workflow** (orchestration) never talks to SQLite directly; it calls
  `recordStep` and `fireEffect`.
- **journal** owns persistence + portability + fork; it derives the idempotency
  key and hands it to the step producer.
- **effect-sink** owns the exactly-once boundary; it *cannot* be called without a
  derived `IdempotencyKey`.
- **idempotency** owns the contract; an `IdempotencyKey` can only be produced by
  `deriveIdempotencyKey(runId, stepName)`.

## Prerequisites

- **Node.js >= 22.5.0** (uses the built-in `node:sqlite` — zero native deps).
  Developed and verified on Node 26.
- No Docker, no cloud. Restate ships as native binaries installed as
  devDependencies; the harness starts a single self-hostable `restate-server`.
- macOS/Linux (the harness uses `pkill` for defensive cleanup).

## Install & build

```bash
npm install
npm run build
```

## Run the workflow manually

```bash
# Terminal 1: start the SDK service
npm run service

# Terminal 2: start restate-server, register, invoke (see harness for the flow)
```

In practice the harness wires all of this up; for a manual run consult
`src/harness/restate-control.ts`.

## Run the crash / verification harness (single command)

```bash
npm test          # == npm run gate
```

This builds, starts a local `restate-server`, and runs the full adversarial gate:
real SIGKILL at every step boundary (including the dangerous after-effect window),
a concurrent-worker race, logical fork, and replay determinism. It exits non-zero
if any gate fails — suitable for CI.

Run a single gate group:

```bash
npm run build && node dist/harness/run-gate.js crash        # crash boundaries only
node dist/harness/run-gate.js concurrency
node dist/harness/run-gate.js fork
node dist/harness/run-gate.js replay
```

The most recent real run is captured verbatim in
[`docs/m1-evidence/gate-evidence.log`](docs/m1-evidence/gate-evidence.log) and
summarized in [`docs/m1-slice.md`](docs/m1-slice.md).

## Configuration (env vars; no hardcoded secrets)

| Variable | Default | Purpose |
|---|---|---|
| `DURABL_DATA_DIR` | `$TMPDIR/durabl-m1` | Root for journal/effect/engine data |
| `DURABL_JOURNAL_DB` | `<root>/journal.db` | Portable step journal |
| `DURABL_EFFECT_DB` | `<root>/effects.db` | Idempotent effect sink |
| `DURABL_SERVICE_PORT` | `9080` | Restate SDK service port |
| `DURABL_RESTATE_INGRESS` | `http://localhost:8080` | Restate ingress |
| `DURABL_RESTATE_ADMIN` | `http://localhost:9070` | Restate admin |

No credentials are read or logged anywhere; all config is filesystem paths and
ports (security baseline §1, §5, §7).

## License

Apache-2.0.
