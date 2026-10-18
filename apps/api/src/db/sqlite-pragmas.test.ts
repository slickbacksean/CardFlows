import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSqliteStore } from "../sqlite-store";
import { applyMvpMigrations, mvpMigrationsFolder } from "./migrate";
import { pendingMigrations, prunePreMigrateCopies, runApplyMigration } from "./apply-migration";
import { readSqlitePragmas } from "./sqlite-pragmas";

const dirs: string[] = [];
function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "cardflow-pragmas-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("SQLite connection pragmas", () => {
  it("a file store runs WAL, foreign_keys=ON, busy_timeout=5000, synchronous=NORMAL", () => {
    const store = createSqliteStore({ sqlitePath: path.join(tempDir(), "cardflow.sqlite") });
    try {
      const raw = new Database(store.sqlitePath);
      // journal_mode is persistent on the file; the rest are per connection, so read them via a fresh migrate.
      expect(String(raw.pragma("journal_mode", { simple: true }))).toBe("wal");
      raw.close();
      expect(store.ping()).toEqual({ ok: true, journalMode: "wal" });
    } finally {
      store.close();
    }
    const { sqlite } = applyMvpMigrations(path.join(dirs[0]!, "cardflow.sqlite"));
    try {
      expect(readSqlitePragmas(sqlite)).toEqual({ journalMode: "wal", foreignKeys: 1, busyTimeout: 5000, synchronous: 1 });
    } finally {
      sqlite.close();
    }
  });

  it("a failing migration closes the handle and rethrows (foreign keys never left off)", () => {
    const folder = path.join(tempDir(), "bad-drizzle");
    mkdirSync(path.join(folder, "meta"), { recursive: true });
    writeFileSync(
      path.join(folder, "meta", "_journal.json"),
      JSON.stringify({ version: "7", dialect: "sqlite", entries: [{ idx: 0, version: "6", when: 1, tag: "0000_bad", breakpoints: true }] }),
    );
    writeFileSync(path.join(folder, "0000_bad.sql"), "THIS IS NOT SQL;");
    const close = vi.spyOn(Database.prototype, "close");
    expect(() => applyMvpMigrations(path.join(dirs.at(-1)!, "x.sqlite"), { migrationsFolder: folder })).toThrow();
    expect(close).toHaveBeenCalled();
  });
});

describe("apply-migration CLI", () => {
  it("copies the DB before pending migrations, and keeps at most N copies", () => {
    const dir = tempDir();
    const db = path.join(dir, "cardflow.sqlite");
    const backups = path.join(dir, "pre-migrate");
    expect(runApplyMigration([db, "--backup-dir", backups])).toMatchObject({ backup: null });
    expect(pendingMigrations(db)).toEqual([]);
    // Nothing pending: no copy.
    expect(runApplyMigration([db, "--backup-dir", backups])).toMatchObject({ applied: 0, backup: null });
    // A DB one migration behind: migrate a fresh file with the journal minus its last entry.
    const older = path.join(dir, "older-drizzle");
    cpSync(mvpMigrationsFolder(), older, { recursive: true });
    const journalPath = path.join(older, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: unknown[] };
    journal.entries.pop();
    writeFileSync(journalPath, JSON.stringify(journal));
    rmSync(db, { force: true });
    rmSync(`${db}-wal`, { force: true });
    rmSync(`${db}-shm`, { force: true });
    applyMvpMigrations(db, { migrationsFolder: older }).sqlite.close();
    const result = runApplyMigration([db, "--backup-dir", backups, "--keep", "1"]);
    expect(result.applied).toBe(1);
    expect(result.backup).toMatch(/pre-migrate\/cardflow-.*-before-.*\.sqlite$/);
    const copy = new Database(result.backup!, { readonly: true });
    expect(copy.prepare("SELECT count(*) AS n FROM __drizzle_migrations").get()).toEqual({ n: journal.entries.length });
    copy.close();
    for (let i = 0; i < 3; i += 1) writeFileSync(path.join(backups, `cardflow-old-${i}.sqlite`), "");
    expect(prunePreMigrateCopies(backups, 2)).toHaveLength(2);
    expect(readdirSync(backups)).toHaveLength(2);
  });

  it("rejects unknown arguments", () => {
    expect(() => runApplyMigration([path.join(tempDir(), "a.sqlite"), "--nope"])).toThrow(/Unknown argument/);
  });
});
