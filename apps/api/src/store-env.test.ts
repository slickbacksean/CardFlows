import { describe, expect, it } from "vitest";
import {
  createStoreFromEnv,
  defaultSqlitePath,
  resolveStoreSelection,
} from "./store-env";
import type { SqliteStorePort } from "./sqlite-store";

describe("store env selection", () => {
  it("keeps tests on memory when CARD_FLOW_SQLITE_PATH is missing", () => {
    expect(resolveStoreSelection({ VITEST: "true" })).toEqual({
      kind: "memory",
      reason: "test without CARD_FLOW_SQLITE_PATH",
    });
    expect(resolveStoreSelection({ NODE_ENV: "test" })).toEqual({
      kind: "memory",
      reason: "test without CARD_FLOW_SQLITE_PATH",
    });
  });

  it("uses the memory adapter when CARD_FLOW_STORE=memory so CI needs no disk", () => {
    expect(
      resolveStoreSelection({
        CARD_FLOW_STORE: "memory",
        CARD_FLOW_SQLITE_PATH: "/tmp/cardflow.sqlite",
      }),
    ).toEqual({ kind: "memory", reason: "CARD_FLOW_STORE=memory" });
  });

  it("treats an empty CARD_FLOW_SQLITE_PATH as missing", () => {
    expect(
      resolveStoreSelection({ VITEST: "true", CARD_FLOW_SQLITE_PATH: "   " }),
    ).toEqual({
      kind: "memory",
      reason: "test without CARD_FLOW_SQLITE_PATH",
    });
  });

  it("opts tests into SQLite when a path is set", () => {
    expect(
      resolveStoreSelection({ VITEST: "true", CARD_FLOW_SQLITE_PATH: ":memory:" }),
    ).toEqual({
      kind: "sqlite",
      sqlitePath: ":memory:",
      reason: "CARD_FLOW_SQLITE_PATH",
    });
  });

  it("defaults local boot to the gitignored SQLite file", () => {
    expect(resolveStoreSelection({})).toEqual({
      kind: "sqlite",
      sqlitePath: defaultSqlitePath(),
      reason: "default sqlite file",
    });
    expect(defaultSqlitePath()).toMatch(/apps\/api\/data\/cardflow\.sqlite$/);
  });

  it("createStoreFromEnv returns memory in test without a path", () => {
    const { store, selection } = createStoreFromEnv({ VITEST: "true" });
    expect(selection.kind).toBe("memory");
    expect(store.listInvitedUsers()[0]?.label).toContain("@cardflow.beta");
    expect("close" in store).toBe(false);
  });

  it("createStoreFromEnv can open :memory: SQLite when a test opts in", () => {
    const { store, selection } = createStoreFromEnv({
      VITEST: "true",
      CARD_FLOW_SQLITE_PATH: ":memory:",
    });
    expect(selection.kind).toBe("sqlite");
    (store as SqliteStorePort).close();
  });
});
