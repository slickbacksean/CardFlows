import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { backfillQuotaAnchors } from "./quota-anchor-backfill";
import { schema } from "./schema";

export function mvpMigrationsFolder(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");
}

export function isMemorySqlitePath(sqlitePath: string): boolean {
  return sqlitePath === ":memory:";
}

/** Apply committed Drizzle migrations to an empty or existing SQLite file. */
export function applyMvpMigrations(sqlitePath: string): {
  sqlite: InstanceType<typeof Database>;
  db: BetterSQLite3Database<typeof schema>;
} {
  if (!isMemorySqlitePath(sqlitePath)) {
    mkdirSync(path.dirname(path.resolve(sqlitePath)), { recursive: true });
  }
  const sqlite = new Database(sqlitePath);
  if (!isMemorySqlitePath(sqlitePath)) {
    sqlite.pragma("journal_mode = WAL");
  }
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  withForeignKeysOff(sqlite, () => {
    migrate(db, { migrationsFolder: mvpMigrationsFolder() });
    // 0016 adds `anchor_at`; existing accounts get their creation/activity date (see the module).
    backfillQuotaAnchors(sqlite);
  });
  return { sqlite, db };
}

/** Runs `fn` with foreign keys off (table rebuilds), and always turns them back on, even if it throws. */
export function withForeignKeysOff<T>(sqlite: InstanceType<typeof Database>, fn: () => T): T {
  sqlite.pragma("foreign_keys = OFF");
  try {
    return fn();
  } finally {
    sqlite.pragma("foreign_keys = ON");
  }
}
