# DBOS integration (stub — NOT RUN)

Steps to wire `src/journal-source-dbos-stub.ts` into a real DBOS-backed `JournalSource`.
**No live DBOS/Postgres integration has been run in this repository.**

| Check | Status |
|-------|--------|
| Stub compiles / exports | **Yes** |
| `dbosJournalSource()` reads DB | **No** |
| Replay parity vs live journal | **NOT RUN** |
| `gate:dbos` | **No** — use `gate:dbos-skip` |
| `gate:harden` H2 | **Yes** (stub smoke) |

See [`docs/SECOND-SUBSTRATE.md`](../SECOND-SUBSTRATE.md).

---

## Today: `journal-source-dbos-stub.ts`

| Export | Behavior |
|--------|----------|
| `dbosJournalSourceStub(cfg?)` | All `JournalSource` reads **throw** |
| `dbosJournalSourceAvailable()` | Env gate; still returns stub |
| `resolveJournalSourceHint()` | `"live"` \| `"import"` \| `"dbos-stub"` |

---

## Environment

| Variable | Role |
|----------|------|
| `DURABL_JOURNAL_SOURCE` | `live` (default), `import`, `dbos` |
| `DBOS_DATABASE_URL` | Reserved for adapter (stub ignores) |
| `DBOS_WORKFLOW_NAME` | Optional → `DbosJournalSourceConfig.workflowName` |

---

## Wire stub → real adapter

### Done

1. Study `JournalSource` (`src/journal-source.ts`) and stub module.
2. `npm run build && npm run gate:harden` — H2 requires throw on `trajectory()`.
3. `npm run gate:dbos-skip` — explicit NOT RUN, exit 0.

### NOT RUN

4. Provision Postgres + DBOS ([docs.dbos.dev](https://docs.dbos.dev/)); set `DBOS_DATABASE_URL`.
5. Implement `dbosJournalSource(config)` with full `JournalSource` surface; map rows → `JournalEntry` / `EffectRow`.
6. Resolver: if `dbosJournalSourceAvailable()`, use real adapter (replace stub).
7. Add `gate:dbos` — run same fixture on Restate + DBOS; compare replay via `JournalSource`.
8. Record versions + gate output in this doc.

---

## Replay

```
DBOS  →  dbosJournalSource()  →  JournalSource  →  replay / inspect / export
```

`src/replay.ts` never imports DBOS directly.

---

## CI

```bash
npm run gate:dbos-skip
```
