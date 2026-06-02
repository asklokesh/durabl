# Second substrate seam (DBOS stub)

M3 proved replay is substrate-independent via `JournalSource`. This document describes the **contract** for a future DBOS-backed adapter — not a working integration.

## Status

| Item | State |
|---|---|
| `src/journal-source-dbos-stub.ts` | Types + throwing stub |
| DBOS runtime / Postgres | **Not implemented** |
| Parity gate vs Restate | **Not implemented** |

## Integration contract (future)

A real `dbosJournalSource(config)` must implement:

- `origin` — stable label (e.g. `dbos-postgres`)
- `allRunIds`, `runMeta`, `trajectory`, `effectsForRun` — same semantics as `liveJournalSource()` / `importJournalSource()`
- Map DBOS step rows → `JournalEntry` + `EffectRow` without losing idempotency keys

Configuration is env-driven (`DBOS_DATABASE_URL`, workflow name) — no hardcoded credentials.

## Why a stub now

Documents the neutrality story for diligence: durabl’s product layer is **journal-format + replay**, not Restate-specific UI. Restate is the shipped substrate; DBOS is an explicit extension point.
