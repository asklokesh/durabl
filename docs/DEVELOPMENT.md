# durabl — development guide

How to develop durabl locally, including parallel git worktrees, gate
verification, and harness locking.

## Single checkout

```bash
git clone <fork> durabl && cd durabl
npm install
npm run build
npm test
```

See `docs/QUICKSTART.md` for the first-run narrative and `CONTRIBUTING.md`
for PR conventions.

## Parallel worktrees

Large features were developed in sibling directories next to the main clone.
Each worktree is a separate checkout on its own branch, sharing one `.git`
object store.

**Main repo**

```bash
/Users/lokesh/git/durabl          # branch: main
```

**Current finalization worktrees** (`feat/final-*` branches — one concern per
directory):

| Directory | Branch |
|---|---|
| `durabl-worktrees` | `feat/final-worktrees` |
| `durabl-arch` | `feat/final-arch` |
| `durabl-ci` | `feat/final-ci` |
| `durabl-docs` | `feat/final-docs` |
| … | … |

Create a new worktree from `main`:

```bash
cd /path/to/durabl
git worktree add ../durabl-my-feature -b feat/my-feature
cd ../durabl-my-feature
npm install
```

Remove a worktree when the branch is merged:

```bash
git worktree remove ../durabl-my-feature
# or, from any checkout:
git worktree remove /path/to/durabl-my-feature
```

### Cleanup: merged parallel tracks

These four worktrees backed the tracks merged in `docs/build-status.md` and
can be removed once you no longer need local evidence on those branches:

- `durabl-productize` (`feat/productize`)
- `durabl-fundability` (`feat/fundability`)
- `durabl-harden` (`feat/harden`)
- `durabl-hitl-web-ui` (`feat/hitl-web-ui`)

Dry run (default):

```bash
npm run cleanup:worktrees
```

Actually remove:

```bash
npm run cleanup:worktrees -- --force
```

The script never removes the main repo or the worktree you run it from.

## Gates

| Command | Scope |
|---|---|
| `npm test` | M1 — idempotency + crash recovery |
| `npm run gate:m2` … `gate:m5` | Milestone gates |
| `npm run gate:live` | Live providers (skips without API keys) |
| `npm run gate:harden` | HTTP retry + second-substrate seam |
| `npm run gate:hitl-ui` | HITL web UI API |
| `npm run gate:all` | Full serial suite (typecheck + M1–M5 + harden + hitl-ui) |

`gate:all` runs gates **one at a time** via `scripts/run-all-gates.sh`. It
teardowns Restate, the service process, and Docker helpers between each gate.
Expect several minutes on a clean machine.

Run individual gates while iterating; run `gate:all` before merge when your
change touches harness, ports, or shared lifecycle code.

## Harness lock file

Every gate calls `enterHarnessGate()` before binding localhost ports and
releases the lock in `exitHarnessGate()`.

| Setting | Default |
|---|---|
| Lock path | `/tmp/durabl-harness.lock` |
| Override | `DURABL_HARNESS_LOCK=/path/to/lock` |

The lock is an exclusive PID file. Only one gate process may hold it. If a
prior run was SIGKILL'd mid-teardown, the next gate waits (up to ~15 minutes)
or reclaims the lock when the holder PID is dead.

Manual recovery:

```bash
rm -f /tmp/durabl-harness.lock
pkill -f restate-server 2>/dev/null || true
pkill -f 'dist/service.js' 2>/dev/null || true
```

`scripts/run-all-gates.sh` also clears the lock on exit.

## Parallel development warning

**Do not run gates in two worktrees at the same time.**

All checkouts share:

- The harness lock file (`/tmp/durabl-harness.lock` unless overridden)
- Localhost ports `8080`, `9070`, `9080`, `7879`, `17878`, `17879`
- Default Restate data under `/tmp/durabl-gate-*` when `DURABL_DATA_DIR` is unset

Running `npm test` in `durabl-arch` while `npm run gate:all` runs in
`durabl-ci` causes port conflicts, stale locks, and flaky failures that look
like product bugs but are environment races.

**Safe pattern:** one gate runner at a time across all worktrees; use
`gate:all` serially before landing harness changes.

Node version and `node_modules` are per worktree — run `npm install` in each
checkout after switching.

## Environment variables (harness)

| Variable | Purpose |
|---|---|
| `DURABL_DATA_DIR` | Restate + effect-sink data root (gate scripts set a per-run temp dir) |
| `DURABL_HARNESS_LOCK` | Override harness lock path |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | Enable live-provider gates |

See `docs/HARDENING.md` and `src/config.ts` for the full config surface.
