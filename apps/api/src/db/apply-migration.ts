import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { applyMvpMigrations, mvpMigrationsFolder } from "./migrate";
import { SQLITE_BUSY_TIMEOUT_MS } from "./sqlite-pragmas";

/**
 * Usage: tsx src/db/apply-migration.ts <sqlite-path> [--backup-dir DIR] [--keep N]
 * The container entrypoint runs this once per deploy under a flock, before node
 * listens. With --backup-dir, a consistent copy (VACUUM INTO) is taken first
 * whenever a migration is pending; only the newest N copies (default 3), and
 * none older than 14 days, are kept.
 */
export const PRE_MIGRATE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

interface JournalEntry {
  tag: string;
  when: number;
}

export function journalEntries(folder = mvpMigrationsFolder()): JournalEntry[] {
  const journal = JSON.parse(readFileSync(path.join(folder, "meta", "_journal.json"), "utf8")) as {
    entries: JournalEntry[];
  };
  return journal.entries;
}

/** Journal entries not yet applied to the file (all of them for a new DB). */
export function pendingMigrations(sqlitePath: string, folder = mvpMigrationsFolder()): JournalEntry[] {
  const entries = journalEntries(folder);
  if (!existsSync(sqlitePath)) return entries;
  const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  try {
    db.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
      .get();
    if (!table) return entries;
    const row = db.prepare("SELECT max(created_at) AS last FROM __drizzle_migrations").get() as { last: number | null };
    const last = Number(row.last ?? 0);
    return entries.filter((entry) => entry.when > last);
  } finally {
    db.close();
  }
}

/** Keep the newest `keep` copies, and drop any older than 14 days. */
export function prunePreMigrateCopies(dir: string, keep: number, nowMs = Date.now()): string[] {
  if (!existsSync(dir)) return [];
  const copies = readdirSync(dir)
    .filter((name) => name.startsWith("cardflow-") && name.endsWith(".sqlite"))
    .map((name) => ({ name, mtime: statSync(path.join(dir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  const removed: string[] = [];
  copies.forEach((copy, index) => {
    if (index >= keep || nowMs - copy.mtime > PRE_MIGRATE_MAX_AGE_MS) {
      rmSync(path.join(dir, copy.name), { force: true });
      removed.push(copy.name);
    }
  });
  return removed;
}

export function runApplyMigration(argv: string[]): { applied: number; latest: string | null; backup: string | null } {
  const [sqlitePath, ...rest] = argv;
  if (!sqlitePath || sqlitePath.startsWith("--")) {
    throw new Error("Usage: tsx src/db/apply-migration.ts <sqlite-path> [--backup-dir DIR] [--keep N]");
  }
  let backupDir: string | null = null;
  let keep = 3;
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === "--backup-dir") backupDir = rest[++i] ?? null;
    else if (rest[i] === "--keep") keep = Math.max(1, Number.parseInt(rest[++i] ?? "", 10) || 3);
    else throw new Error(`Unknown argument: ${rest[i]}`);
  }
  const pending = pendingMigrations(sqlitePath);
  let backup: string | null = null;
  if (backupDir && pending.length > 0 && existsSync(sqlitePath)) {
    mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    backup = path.join(backupDir, `cardflow-${stamp}-before-${pending[0]!.tag}.sqlite`);
    const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
    try {
      db.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
      db.prepare("VACUUM INTO ?").run(backup);
    } finally {
      db.close();
    }
  }
  if (backupDir) prunePreMigrateCopies(backupDir, keep);
  const { sqlite } = applyMvpMigrations(sqlitePath);
  sqlite.close();
  return { applied: pending.length, latest: pending.at(-1)?.tag ?? null, backup };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join("db", "apply-migration.ts"));
if (invokedDirectly) {
  try {
    const result = runApplyMigration(process.argv.slice(2));
    if (result.backup) console.log(`pre-migration copy: ${result.backup}`);
    console.log(`applied ${result.applied} migrations${result.latest ? ` (latest ${result.latest})` : ""}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
