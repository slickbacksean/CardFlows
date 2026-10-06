import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSqliteStore } from "./sqlite-store";
import { createMemoryStore, type StorePort } from "./store";

export type StoreKind = "memory" | "sqlite";

export type StoreSelection =
  | { kind: "memory"; reason: string }
  | { kind: "sqlite"; sqlitePath: string; reason: string };

type Env = NodeJS.Dict<string | undefined>;

export function defaultSqlitePath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/cardflow.sqlite");
}

function envValue(env: Env, key: string): string | undefined {
  const value = env[key];
  if (value === undefined || value.trim() === "") return undefined;
  return value;
}

function isTestEnv(env: Env): boolean {
  return env.VITEST === "true" || env.NODE_ENV === "test";
}

export function resolveSqlitePath(raw: string | undefined): string {
  if (!raw) return defaultSqlitePath();
  if (raw === ":memory:") return ":memory:";
  return path.isAbsolute(raw) ? raw : path.resolve(raw);
}

/**
 * Memory in CI/tests unless a path is set. Local API defaults to a gitignored SQLite file.
 */
export function resolveStoreSelection(env: Env = process.env): StoreSelection {
  if (envValue(env, "CARD_FLOW_STORE") === "memory") {
    return { kind: "memory", reason: "CARD_FLOW_STORE=memory" };
  }

  const sqlitePath = envValue(env, "CARD_FLOW_SQLITE_PATH");
  if (isTestEnv(env) && !sqlitePath) {
    return { kind: "memory", reason: "test without CARD_FLOW_SQLITE_PATH" };
  }

  return {
    kind: "sqlite",
    sqlitePath: resolveSqlitePath(sqlitePath),
    reason: sqlitePath ? "CARD_FLOW_SQLITE_PATH" : "default sqlite file",
  };
}

export function createStoreFromEnv(env: Env = process.env): {
  store: StorePort;
  selection: StoreSelection;
} {
  const selection = resolveStoreSelection(env);
  if (selection.kind === "memory") {
    return { store: createMemoryStore(), selection };
  }
  return {
    store: createSqliteStore({ sqlitePath: selection.sqlitePath }),
    selection,
  };
}
