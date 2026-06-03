# DBOS integration (partial — file export shipped)

durabl’s DBOS path is **journal-format + replay** via `JournalSource`, not an embedded DBOS runtime.

| Check | Status |
|-------|--------|
| `dbosJournalSourceFromPath` / `FromExport` | **Yes** — portable JSONL export |
| `gate:dbos` (D1–D4) | **Yes** — parity vs `importJournalSource` on M3 fixture |
| `dbosJournalSource()` Postgres reads | **NOT RUN** |
| DBOS SDK + agent on Postgres in CI | **NOT RUN** |
| `gate:dbos-skip` | Runs `gate:dbos`, then notes Postgres NOT RUN |

See [`docs/SECOND-SUBSTRATE.md`](../SECOND-SUBSTRATE.md).

---

## Shipped: file-backed adapter (`journal-source-dbos-stub.ts`)

| Export | Behavior |
|--------|----------|
| `dbosJournalSourceFromExport(jsonl, cfg?)` | `JournalSource` over portable JSONL (DBOS-labeled origin) |
| `dbosJournalSourceFromPath(path, cfg?)` | Read file → same as above |
| `dbosJournalSource(cfg?)` | Uses `DBOS_JOURNAL_EXPORT` when set; else **stub** (throws on read) |
| `dbosJournalSourceStub(cfg?)` | Throwing placeholder (H2 harden gate) |
| `dbosExportJournalSourceAvailable()` | Export path exists |
| `dbosJournalSourceAvailable()` | Same as export-available (Postgres not wired) |
| `resolveJournalSourceHint()` | `"live"` \| `"import"` \| `"dbos-export"` \| `"dbos-stub"` |

CLI: `DURABL_JOURNAL_SOURCE=dbos` + `DBOS_JOURNAL_EXPORT=/path/bundle.jsonl` uses the file adapter for replay commands (no `--from` required).

---

## Environment

| Variable | Role |
|----------|------|
| `DURABL_JOURNAL_SOURCE` | `live` (default), `import`, `dbos` |
| `DBOS_JOURNAL_EXPORT` | Path to portable JSONL (file-backed adapter) |
| `DBOS_DATABASE_URL` | Reserved for future Postgres adapter (stub throws if only this is set) |
| `DBOS_WORKFLOW_NAME` | Optional → `DbosJournalSourceConfig.workflowName` (default `AgentRun`) |

---

## Architecture

```
┌─────────────────┐     export / ETL      ┌──────────────────────────┐
│ DBOS workflow   │ ──────────────────────► │ portable JSONL (durabl) │
│ (Postgres)      │   (future; NOT RUN)     └───────────┬──────────────┘
└─────────────────┘                                     │
                                                        ▼
                              dbosJournalSourceFromPath ──► JournalSource ──► replay / inspect / export
```

`src/replay.ts` never imports DBOS directly.

---

## Done vs NOT RUN

### Done

1. `JournalSource` contract (`src/journal-source.ts`) + file-backed DBOS adapter.
2. `npm run gate:dbos` — fixture load, replay parity vs import, stub throw, hint resolution.
3. `npm run test:dbos` — unit tests on committed M3 bundle.
4. `npm run gate:harden` H2 — stub still throws when export unset.

### NOT RUN (next milestone)

1. Provision Postgres + DBOS ([docs.dbos.dev](https://docs.dbos.dev/)); map `dbos_*` step rows → `JournalEntry` / `EffectRow`.
2. `dbosJournalSource()` Postgres branch when `DBOS_DATABASE_URL` set and export unset.
3. Live agent run on DBOS + export bundle; `gate:dbos-live` comparing live DBOS export vs Restate export.
4. Record DBOS SDK / Postgres versions in this doc.

---

## CI

```bash
npm run gate:dbos
npm run test:dbos
npm run gate:dbos-skip   # gate:dbos + explicit Postgres NOT RUN banner
```
