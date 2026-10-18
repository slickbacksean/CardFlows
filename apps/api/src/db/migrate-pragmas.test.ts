import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { applyMvpMigrations, withForeignKeysOff } from "./migrate";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("SQLite startup pragmas", () => {
  it("a file database starts with foreign_keys=ON, journal_mode=WAL and busy_timeout=5000", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cardflow-pragmas-"));
    dirs.push(dir);
    const { sqlite } = applyMvpMigrations(path.join(dir, "cardflow.sqlite"));
    try {
      expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
      expect(sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
      expect(sqlite.pragma("busy_timeout", { simple: true })).toBe(5000);
    } finally {
      sqlite.close();
    }
  });

  it("foreign keys are back ON even when the migration step throws", () => {
    const sqlite = new Database(":memory:");
    try {
      expect(() =>
        withForeignKeysOff(sqlite, () => {
          expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(0);
          throw new Error("migration failed");
        }),
      ).toThrow("migration failed");
      expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    } finally {
      sqlite.close();
    }
  });
});
