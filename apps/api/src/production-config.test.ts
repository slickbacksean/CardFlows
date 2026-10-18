import { describe, expect, it } from "vitest";
import { assertProductionConfig, backupEnvProblem, productionConfigProblems, sqliteVolumeProblem } from "./production-config";

describe("H3 production config", () => {
  it("refuses production without CARD_FLOW_TRUST_PROXY_HOPS", () => {
    expect(() => assertProductionConfig({ NODE_ENV: "production" })).toThrow(/CARD_FLOW_TRUST_PROXY_HOPS/);
    expect(() => assertProductionConfig({ NODE_ENV: "production", CARD_FLOW_TRUST_PROXY_HOPS: "abc" })).toThrow();
  });
  it("accepts an explicit value, including 0, and ignores development", () => {
    expect(productionConfigProblems({ NODE_ENV: "production", CARD_FLOW_TRUST_PROXY_HOPS: "0" })).toEqual([]);
    expect(productionConfigProblems({ NODE_ENV: "production", CARD_FLOW_TRUST_PROXY_HOPS: "1" })).toEqual([]);
    expect(productionConfigProblems({ NODE_ENV: "development" })).toEqual([]);
  });

  it("on Railway, refuses a DB outside the mounted volume (or no volume)", () => {
    const base = { NODE_ENV: "production", RAILWAY_ENVIRONMENT_NAME: "production", CARD_FLOW_SQLITE_PATH: "/data/cardflow.sqlite" };
    expect(sqliteVolumeProblem(base)).toMatch(/No Railway volume/);
    expect(sqliteVolumeProblem({ ...base, RAILWAY_VOLUME_MOUNT_PATH: "/data" })).toBeNull();
    expect(sqliteVolumeProblem({ ...base, RAILWAY_VOLUME_MOUNT_PATH: "/vol" })).toMatch(/must be inside the volume/);
    expect(sqliteVolumeProblem({ ...base, CARD_FLOW_REQUIRE_VOLUME: "false" })).toBeNull();
    // Off Railway (CI, local docker) the check is skipped unless forced.
    expect(sqliteVolumeProblem({ NODE_ENV: "production", CARD_FLOW_SQLITE_PATH: "/data/cardflow.sqlite" })).toBeNull();
    expect(sqliteVolumeProblem({ NODE_ENV: "production", CARD_FLOW_REQUIRE_VOLUME: "true" })).toMatch(/No Railway volume/);
  });
  it("CARD_FLOW_BACKUPS_REQUIRED=true needs the Litestream bucket and keys", () => {
    expect(backupEnvProblem({})).toBeNull();
    expect(backupEnvProblem({ CARD_FLOW_BACKUPS_REQUIRED: "true", LITESTREAM_BUCKET: "b" })).toMatch(/LITESTREAM_ENDPOINT/);
    expect(
      backupEnvProblem({
        CARD_FLOW_BACKUPS_REQUIRED: "true",
        LITESTREAM_BUCKET: "b",
        LITESTREAM_ENDPOINT: "https://x",
        LITESTREAM_ACCESS_KEY_ID: "k",
        LITESTREAM_SECRET_ACCESS_KEY: "s",
      }),
    ).toBeNull();
  });
});
