import type Database from "better-sqlite3";

export const SQLITE_BUSY_TIMEOUT_MS = 5000;

/** Every app connection: call immediately after `new Database(path)`. */
export function configureSqliteConnection(sqlite: InstanceType<typeof Database>, opts: { memory: boolean }): void {
  // First, so the WAL switch waits for a lock instead of failing.
  sqlite.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
  if (!opts.memory) {
    const mode = sqlite.pragma("journal_mode = WAL", { simple: true });
    if (String(mode).toLowerCase() !== "wal") throw new Error(`SQLite refused WAL (got ${String(mode)})`);
    // Safe with WAL; the volume plus Litestream give durability.
    sqlite.pragma("synchronous = NORMAL");
  }
  sqlite.pragma("foreign_keys = ON");
}

/** The effective settings (used by /health and tests). synchronous 1 = NORMAL. */
export function readSqlitePragmas(sqlite: InstanceType<typeof Database>) {
  return {
    journalMode: String(sqlite.pragma("journal_mode", { simple: true })),
    foreignKeys: Number(sqlite.pragma("foreign_keys", { simple: true })),
    busyTimeout: Number(sqlite.pragma("busy_timeout", { simple: true })),
    synchronous: Number(sqlite.pragma("synchronous", { simple: true })),
  };
}
