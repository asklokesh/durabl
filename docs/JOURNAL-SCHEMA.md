# durabl journal schema

The durabl journal has two versioned surfaces:

| Surface | Version constant | What it versions |
|---------|------------------|------------------|
| **Portable JSONL export** | `JOURNAL_SCHEMA_VERSION` in `src/step-model.ts` (currently `1`) | Record shapes in exported `.jsonl` files |
| **SQLite store** | `JOURNAL_DB_VERSION` in `src/journal-migrate.ts` (currently `1`) | Tables and indexes in `journal.db` |

Portable export types: `JournalEntry`, `RunMeta`, and effect lines in `src/step-model.ts` and `exportJsonl*` in `src/journal.ts`. When present, machine-readable export schema: [`schemas/journal-v1.json`](../schemas/journal-v1.json).

---

## SQLite migrations

The on-disk journal (`DURABL_JOURNAL_DB`, default under `DURABL_DATA_DIR`) is migrated via a version table and numbered `up` steps in `src/journal-migrate.ts`.

### `journal_schema_version` table

| Column | Type | Description |
|--------|------|-------------|
| `version` | INTEGER PRIMARY KEY | Applied migration number (1, 2, …) |
| `applied_at` | TEXT | ISO-8601 timestamp when the migration ran |
| `description` | TEXT | Human-readable label for the step |

`currentJournalDbVersion()` returns `MAX(version)`, or `0` if the table does not exist yet (legacy databases created before migrations).

### Running migrations

```bash
npm run journal:migrate
```

Prints whether the database was already current or which versions were applied. Uses the same path resolution as the runtime (`config.journalDbPath` / `DURABL_JOURNAL_DB`).

Every journal open (`journal.ts` → `openMigratedJournalDatabase()`) also runs pending migrations, so `recordStep` and gate paths stay compatible without a separate migrate step.

### Adding a migration

1. Bump `JOURNAL_DB_VERSION` in `src/journal-migrate.ts`.
2. Append a new entry to `MIGRATIONS` with the next contiguous `version` and an `up(db)` that performs the DDL change (prefer idempotent `IF NOT EXISTS` where possible).
3. Document the change in this section (version number, purpose, operator notes).
4. Run `npm run journal:migrate` against a copy of a real `journal.db` when testing upgrades.

**Migration v1 (baseline):** creates `step_journal`, `run_meta`, `step_journal_idem` unique index, and `journal_schema_version`. Databases that already had the two data tables from older `journal.ts` bootstrap are recorded as version 1 without data loss (`CREATE TABLE IF NOT EXISTS`).

### Portable export vs SQLite

Breaking changes to **JSONL** record shapes require bumping `JOURNAL_SCHEMA_VERSION`, updating `schemas/journal-vN.json`, and documenting export migration for importers.

Breaking changes to **SQLite** layout require a new `JOURNAL_DB_VERSION` migration here. Keep the two version numbers independent — export schema and store layout evolve on different cadences.
