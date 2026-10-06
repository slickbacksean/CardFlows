import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
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
  sqlite.pragma("foreign_keys = OFF");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: mvpMigrationsFolder() });
  sqlite.pragma("foreign_keys = ON");
  return { sqlite, db };
}
