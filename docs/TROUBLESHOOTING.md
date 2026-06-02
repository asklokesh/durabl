# durabl — troubleshooting

Common failures when running gates, demos, or the replay/HITL UI on a single
machine. For development workflow (worktrees, serial gates), see
[`DEVELOPMENT.md`](DEVELOPMENT.md).

---

## Harness lock stuck (`/tmp/durabl-harness.lock`)

**Symptom:** `npm test` or `npm run gate:*` hangs at startup, or errors with
`harness lock timeout (/tmp/durabl-harness.lock)`.

**Cause:** Every gate calls `enterHarnessGate()` in `src/harness/restate-control.ts`
before binding localhost ports. The lock is an exclusive PID file — only one gate
process may hold it. If a prior run was **SIGKILL'd** mid-teardown, the lock may
still exist while the holder PID is dead (reclaimed automatically) or a zombie
holder is still alive.

| Setting | Default |
|---------|---------|
| Lock path | `/tmp/durabl-harness.lock` |
| Override | `DURABL_HARNESS_LOCK=/path/to/lock` |
| Wait | Up to ~15 minutes (`acquireHarnessLock` default 900s) |

**Fix:**

```bash
rm -f /tmp/durabl-harness.lock
pkill -f restate-server 2>/dev/null || true
pkill -f 'dist/service.js' 2>/dev/null || true
```

`scripts/run-all-gates.sh` clears the lock on exit. Do **not** run gates in two
worktrees at once — they share the same lock and ports (see
[`DEVELOPMENT.md` § Parallel development warning](DEVELOPMENT.md#parallel-development-warning)).

---

## `EADDRINUSE` on port 8080 (or 9070 / 9080 / 7879 / 17878 / 17879)

**Symptom:** Restate or the SDK service fails to start; logs mention address
already in use. Most often **8080** (Restate ingress).

**Cause:** Another gate, demo, `npm run service`, Docker `docker-demo` profile,
or a stale `restate-server` still owns the port.

**Default ports:**

| Port | Role |
|------|------|
| `8080` | Restate ingress (`DURABL_RESTATE_INGRESS`) |
| `9070` | Restate admin (`DURABL_RESTATE_ADMIN`) |
| `9080` | durabl SDK service (`DURABL_SERVICE_PORT`) |
| `7878` / `7879` | Replay UI (gate scripts may use `17878` / `17879`) |

**Fix:**

```bash
lsof -i :8080 -i :9070 -i :9080 2>/dev/null

pkill -f restate-server 2>/dev/null || true
pkill -f 'dist/service.js' 2>/dev/null || true
docker compose --profile docker-demo down 2>/dev/null || true
rm -f /tmp/durabl-harness.lock
```

Then rerun **one** gate at a time. For Docker demo, set
`DURABL_RESTATE_INGRESS=http://127.0.0.1:8080` when calling from the host
([`README.md`](../README.md#optional-restate-in-docker)).

---

## SIGKILL during gate teardown

**Symptom:** Next gate flakes (lock held, ports busy, `registerDeployment`
`META0003` / connection refused to `localhost:9080`). Documented in
[`docs/QUICKSTART.md`](QUICKSTART.md) release verification.

**Cause:** Crash gates use a real **uncatchable** `SIGKILL` on the SDK service
(and sometimes the gate process itself) to prove durability. Teardown is
best-effort; killing mid-teardown leaves Restate or the service port in a dirty
state.

**Fix:** Same as lock + port cleanup above. Prefer `npm run gate:all` (serial
teardown between gates) over overlapping manual gate runs. Gates print their
summary **before** releasing the lock to reduce SIGKILL during heavy
`harnessTeardown` ([`docs/build-status.md`](build-status.md)).

---

## Offline HITL: `POST /api/hitl/input` returns **503**

**Symptom:** Replay UI or API client gets HTTP 503 when submitting human input
from an export (`durabl ui --from export.jsonl`).

**Cause:** **By design.** Paused runs are visible from the JSONL export (journal
has `hitl_pause` without `hitl_input`), but resolving the durable promise requires
**live** Restate ingress (`provideInput`), not the file alone. The server returns
503 in non-live mode:

```text
HITL submit requires live mode (SQLite journal + Restate ingress).
Offline export can list paused runs but cannot resolve the durable promise.
```

Source: `src/server.ts` (`handleHitlInput` when `!ctx.live`).

**What works offline:** `GET /api/hitl/paused`, replay timeline, `hitlState` on
runs — read-only. **What needs live mode:** `POST /api/hitl/input`, CLI
`durabl hitl-input`, completing a paused run.

**Fix:** Start substrate + service, run UI without `--from`, or use live mode
after import. See [`hitl-web-ui.md`](hitl-web-ui.md) and
[`m5-hitl-export.md`](m5-hitl-export.md).

---

## Still stuck?

1. Run one gate: `npm test` (M1 only).
2. Confirm Node **>= 22.5.0** (built-in `node:sqlite`).
3. Check [`build-status.md`](build-status.md) for expected gate counts.
4. Open an issue with the gate command, lock file contents (`cat /tmp/durabl-harness.lock`), and `lsof` for 8080/9080 — no API keys or journal paths with secrets.
