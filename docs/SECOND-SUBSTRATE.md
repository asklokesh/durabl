# Second substrate seam (DBOS — partial)

M3 proved replay is substrate-independent via `JournalSource`. **Shipped:** file-backed DBOS adapter over portable JSONL exports. **Not shipped:** live Postgres / DBOS SDK reads.

**Wiring guide:** [`docs/integrations/dbos.md`](integrations/dbos.md)

---

## Status

| Item | State |
|------|--------|
| `src/journal-source-dbos-stub.ts` | File adapter + throwing stub |
| `dbosJournalSourceFromPath` / `FromExport` | **Yes** |
| `dbosJournalSource()` (Postgres reads) | **Not implemented — NOT RUN** |
| DBOS runtime / Postgres in CI | **Not implemented — NOT RUN** |
| Parity gate (`gate:dbos`) | **Yes** — offline export vs import |
| `npm run gate:dbos-skip` | **Yes** — runs `gate:dbos`, notes Postgres NOT RUN |
| `npm run gate:harden` H2 | **Yes** — stub throws when export unset |

---

## Module map (`journal-source-dbos-stub.ts`)

| Symbol | Purpose |
|--------|---------|
| `DbosJournalSourceConfig` | `databaseUrl?`, `workflowName?`, `exportPath?` |
| `dbosJournalSourceFromExport` / `FromPath` | Real `JournalSource` over JSONL |
| `dbosJournalSource` | Export path from env → adapter; else stub |
| `dbosJournalSourceStub` | Throwing `JournalSource` for H2 / unset export |
| `dbosJournalSourceAvailable()` | `DBOS_JOURNAL_EXPORT` file exists |
| `resolveJournalSourceHint()` | `"live"` \| `"import"` \| `"dbos-export"` \| `"dbos-stub"` |

Exported from `src/index.ts`. Default product path: `liveJournalSource()`.

---

## Integration contract

Same methods as `liveJournalSource()` / `importJournalSource()` in `src/journal-source.ts`:

| Method | Semantics |
|--------|-----------|
| `origin` | e.g. `dbos-journal(export=m3-portable-bundle.jsonl;workflow=AgentRun)` |
| `allRunIds()` | All run ids in the export |
| `runMeta` / `childRuns` | Lineage (`RunMeta` in `src/step-model.ts`) |
| `trajectory` | Ordered `JournalEntry[]` |
| `effectsFor` | `EffectRow[]` (may be `[]`) |

Future Postgres adapter: map DBOS step rows without dropping idempotency keys. Config via env — no hardcoded credentials.

---

## Wiring checklist

| Step | Done? |
|------|--------|
| Stub + H2 harden gate | **Yes** |
| File-export adapter + `gate:dbos` | **Yes** |
| Docs + `gate:dbos-skip` (Postgres banner) | **Yes** |
| DBOS + Postgres for live agent | **NOT RUN** |
| `dbosJournalSource()` SQL implementation | **No** |
| `gate:dbos-live` (live DBOS vs Restate) | **No** |

---

## CI

```bash
npm run gate:dbos
npm run gate:dbos-skip
```

---

## Why partial now

durabl’s product layer is **journal-format + replay**, not Restate-specific UI. Restate is shipped; DBOS is an extension point with a **working offline adapter** today and Postgres as the next increment.
