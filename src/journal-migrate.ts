// SQLite schema migrations for the portable step journal (journal.db).
// Portable JSONL export versioning lives in step-model.ts (JOURNAL_SCHEMA_VERSION).

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

/** Latest applied SQLite layout version for config.journalDbPath. */
export const JOURNAL_DB_VERSION = 1 as const;

export interface JournalMigration {
  readonly version: number;
  readonly description: string;
  readonly up: (db: DatabaseSync) => void;
}

export interface MigrateJournalResult {
  readonly dbPath: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly applied: readonly number[];
}

const MIGRATIONS: readonly JournalMigration[] = [
  {
    version: 1,
    description: "baseline step_journal, run_meta, journal_schema_version",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS step_journal (
          schema      INTEGER NOT NULL,
          run_id      TEXT NOT NULL,
          seq         INTEGER NOT NULL,
          step_name   TEXT NOT NULL,
          kind        TEXT NOT NULL,
          idem_key    TEXT NOT NULL,
          output      TEXT NOT NULL,
          side_effect INTEGER NOT NULL DEFAULT 0,
          seeded_from TEXT,
          recorded_at TEXT NOT NULL,
          PRIMARY KEY (run_id, seq)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS step_journal_idem
          ON step_journal (run_id, idem_key);

        CREATE TABLE IF NOT EXISTS run_meta (
          schema        INTEGER NOT NULL,
          run_id        TEXT PRIMARY KEY,
          parent_run    TEXT,
          forked_at_seq INTEGER,
          trajectory    TEXT NOT NULL,
          created_at    TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS journal_schema_version (
          version     INTEGER NOT NULL PRIMARY KEY,
          applied_at  TEXT NOT NULL,
          description TEXT NOT NULL
        );
      `);
    },
  },
] as const;

function assertMigrationChain(): void {
  for (let i = 0; i < MIGRATIONS.length; i++) {
    const expected = i + 1;
    if (MIGRATIONS[i]!.version !== expected) {
      throw new Error(
        `journal migrations must be contiguous from 1; got ${MIGRATIONS[i]!.version} at index ${i}`,
      );
    }
  }
  if (MIGRATIONS.length > 0 && MIGRATIONS[MIGRATIONS.length - 1]!.version !== JOURNAL_DB_VERSION) {
    throw new Error(
      `JOURNAL_DB_VERSION (${JOURNAL_DB_VERSION}) must match last migration (${MIGRATIONS[MIGRATIONS.length - 1]!.version})`,
    );
  }
}

assertMigrationChain();

function journalSchemaVersionTableExists(db: DatabaseSync): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM sqlite_master
       WHERE type = 'table' AND name = 'journal_schema_version'`,
    )
    .get() as { ok: number } | undefined;
  return row !== undefined;
}

/** Highest version recorded in journal_schema_version, or 0 before first migrate. */
export function currentJournalDbVersion(db: DatabaseSync): number {
  if (!journalSchemaVersionTableExists(db)) return 0;
  const row = db
    .prepare(`SELECT MAX(version) AS v FROM journal_schema_version`)
    .get() as { v: number | null };
  return row.v ?? 0;
}

/** Open journal.db with WAL pragmas; does not run migrations. */
export function openJournalDatabase(dbPath = config.journalDbPath): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

/**
 * Apply pending SQLite migrations. Idempotent: safe to call on every journal open.
 * Existing databases created before the version table are upgraded from version 0.
 */
export function migrateJournal(options?: {
  dbPath?: string;
  db?: DatabaseSync;
}): MigrateJournalResult {
  const dbPath = options?.dbPath ?? config.journalDbPath;
  const owned = options?.db === undefined;
  const db = options?.db ?? openJournalDatabase(dbPath);
  const fromVersion = currentJournalDbVersion(db);
  const applied: number[] = [];

  try {
    for (const migration of MIGRATIONS) {
      if (migration.version <= fromVersion) continue;
      if (migration.version !== fromVersion + applied.length + 1) {
        throw new Error(
          `journal DB at version ${fromVersion}; cannot apply migration ${migration.version} out of order`,
        );
      }
      db.exec("BEGIN");
      try {
        migration.up(db);
        db.prepare(
          `INSERT INTO journal_schema_version (version, applied_at, description)
           VALUES (?, ?, ?)`,
        ).run(
          migration.version,
          new Date().toISOString(),
          migration.description,
        );
        db.exec("COMMIT");
        applied.push(migration.version);
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    }
  } finally {
    if (owned) db.close();
  }

  return {
    dbPath,
    fromVersion,
    toVersion: fromVersion + applied.length,
    applied,
  };
}

/** Open journal.db and ensure schema is at {@link JOURNAL_DB_VERSION}. */
export function openMigratedJournalDatabase(dbPath = config.journalDbPath): DatabaseSync {
  const db = openJournalDatabase(dbPath);
  migrateJournal({ db });
  return db;
}

function main(): void {
  const result = migrateJournal();
  const summary =
    result.applied.length === 0
      ? `journal.db already at version ${result.toVersion} (${result.dbPath})`
      : `journal.db migrated ${result.fromVersion} → ${result.toVersion} applied=[${result.applied.join(",")}] (${result.dbPath})`;
  console.log(summary);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
