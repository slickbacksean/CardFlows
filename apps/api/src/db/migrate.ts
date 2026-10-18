import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { backfillQuotaAnchors } from "./quota-anchor-backfill";
import { configureSqliteConnection } from "./sqlite-pragmas";
import { schema } from "./schema";

export function mvpMigrationsFolder(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");
}

export function isMemorySqlitePath(sqlitePath: string): boolean {
  return sqlitePath === ":memory:";
}

/** Apply committed Drizzle migrations to an empty or existing SQLite file. */
export function applyMvpMigrations(
  sqlitePath: string,
  opts: { migrationsFolder?: string } = {},
): {
  sqlite: InstanceType<typeof Database>;
  db: BetterSQLite3Database<typeof schema>;
} {
  const memory = isMemorySqlitePath(sqlitePath);
  if (!memory) mkdirSync(path.dirname(path.resolve(sqlitePath)), { recursive: true });
  const sqlite = new Database(sqlitePath);
  try {
    configureSqliteConnection(sqlite, { memory });
    const db = drizzle(sqlite, { schema });
    // FK must be OFF for table-rebuild migrations. The pragma is a no-op inside a
    // transaction, so it is set outside, and always switched back on.
    sqlite.pragma("foreign_keys = OFF");
    try {
      migrate(db, { migrationsFolder: opts.migrationsFolder ?? mvpMigrationsFolder() });
      // 0016 adds `anchor_at`; existing accounts get their creation/activity date (see the module).
      backfillQuotaAnchors(sqlite);
    } finally {
      sqlite.pragma("foreign_keys = ON");
    }
    if (Number(sqlite.pragma("foreign_keys", { simple: true })) !== 1) throw new Error("foreign_keys did not re-enable");
    const violations = sqlite.prepare("PRAGMA foreign_key_check").all();
    // Warn, don't block boot (legacy rows); the restore drill checks this too.
    if (violations.length > 0) console.warn(JSON.stringify({ event: "sqlite_fk_violations", count: violations.length }));
    return { sqlite, db };
  } catch (err) {
    sqlite.close();
    throw err;
  }
}
