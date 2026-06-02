# Second substrate seam (DBOS stub)

M3 proved replay is substrate-independent via `JournalSource`. This document describes the **contract** for a future DBOS-backed adapter — not a working integration.

**Wiring guide:** [`docs/integrations/dbos.md`](integrations/dbos.md)

---

## Status

| Item | State |
|------|--------|
| `src/journal-source-dbos-stub.ts` | Types + throwing stub |
| `dbosJournalSource()` (Postgres reads) | **Not implemented — NOT RUN** |
| DBOS runtime / Postgres in CI | **Not implemented — NOT RUN** |
| Parity gate (`gate:dbos`) | **Not implemented — NOT RUN** |
| `npm run gate:dbos-skip` | **Yes** — explicit skip, exit 0 |
| `npm run gate:harden` H2 | **Yes** — stub throws on read (smoke only) |

---

## Module map (`journal-source-dbos-stub.ts`)

| Symbol | Purpose |
|--------|---------|
| `DbosJournalSourceConfig` | `databaseUrl?`, `workflowName?` |
| `dbosJournalSourceStub(cfg?)` | Throwing `JournalSource`; `origin` like `dbos-stub(unimplemented…)` |
| `dbosJournalSourceAvailable()` | `DURABL_JOURNAL_SOURCE=dbos` + `DBOS_DATABASE_URL` (still stub) |
| `resolveJournalSourceHint()` | `"live"` \| `"import"` \| `"dbos-stub"` |

Exported from `src/index.ts`. Default path: `liveJournalSource()`.

---

## Integration contract (future)

Implement the same methods as `liveJournalSource()` / `importJournalSource()` in `src/journal-source.ts`:

| Method | Semantics |
|--------|-----------|
| `origin` | Stable label (e.g. `dbos-postgres(workflow=AgentRun)`) |
| `allRunIds()` | All run ids in the DBOS-backed store |
| `runMeta` / `childRuns` | Lineage (`RunMeta` in `src/step-model.ts`) |
| `trajectory` | Ordered `JournalEntry[]` |
| `effectsFor` | `EffectRow[]` (may be `[]`) |

Map DBOS rows → journal types without dropping idempotency keys. Config via env (`DBOS_DATABASE_URL`, workflow name) — no hardcoded credentials.

---

## Wiring checklist

| Step | Done? |
|------|--------|
| Stub + H2 harden gate | **Yes** |
| Docs + `gate:dbos-skip` | **Yes** |
| DBOS + Postgres for agent | **NOT RUN** |
| `dbosJournalSource()` implementation | **No** |
| `gate:dbos` parity | **No** |

---

## CI

```bash
npm run gate:dbos-skip   # NOT RUN placeholder, exit 0
```

---

## Why a stub now

durabl’s product layer is **journal-format + replay**, not Restate-specific UI. Restate is shipped; DBOS is an explicit extension point.
