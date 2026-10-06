import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { applyMvpMigrations } from "./migrate";
import { cardflowCards } from "./schema";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationSql = readFileSync(
  path.join(apiRoot, "drizzle/0000_mvp_crm_schema.sql"),
  "utf8",
);

function sampleCard(cardflowCardId: string, tcgdexId: string) {
  return {
    cardflowCardId,
    language: "en",
    tcgdexId,
    tcgdexSetId: "base1",
    localId: tcgdexId.split("-")[1] ?? tcgdexId,
    name: "Pikachu",
    setName: "Base Set",
    rarity: "Common",
    category: "Pokemon",
    variantsJson: JSON.stringify({
      firstEdition: false,
      holo: false,
      normal: true,
      reverse: false,
    }),
    imageBaseUrl: `https://assets.tcgdex.net/en/base/base1/${tcgdexId.split("-")[1] ?? "58"}`,
    updatedAt: "2026-09-16T00:00:00.000Z",
  };
}

describe("MVP CRM schema", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applies migrations to an empty SQLite file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cardflow-schema-"));
    tempDirs.push(dir);
    const sqlitePath = path.join(dir, "empty.sqlite");
    const { sqlite } = applyMvpMigrations(sqlitePath);
    const tables = sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '__drizzle_migrations' ORDER BY name`)
      .all() as Array<{ name: string }>;
    sqlite.close();

    expect(tables.map((row) => row.name)).toEqual([
      "card_external_ids",
      "cardflow_cards",
      "crm_confirmations",
      "crm_grading_returned",
      "crm_grading_submitted",
      "crm_inventory_items",
      "crm_listing_drafts",
      "crm_pokecollector_users",
      "crm_purchases",
      "crm_scans",
      "crm_sessions",
      "grade_estimate_cache",
      "portfolio_value_snapshots",
      "user_preferences",
    ]);
  });

  it("enforces unique (language, tcgdex_id)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cardflow-schema-"));
    tempDirs.push(dir);
    const { sqlite, db } = applyMvpMigrations(path.join(dir, "empty.sqlite"));

    db.insert(cardflowCards).values(sampleCard("card-1", "base1-58")).run();
    expect(() =>
      db.insert(cardflowCards).values(sampleCard("card-2", "base1-58")).run(),
    ).toThrow(/UNIQUE/i);
    db.insert(cardflowCards).values(sampleCard("card-3", "base1-4")).run();

    const rows = sqlite
      .prepare(`SELECT cardflow_card_id, tcgdex_id FROM cardflow_cards ORDER BY tcgdex_id`)
      .all() as Array<{ cardflow_card_id: string; tcgdex_id: string }>;
    sqlite.close();
    expect(rows).toEqual([
      { cardflow_card_id: "card-3", tcgdex_id: "base1-4" },
      { cardflow_card_id: "card-1", tcgdex_id: "base1-58" },
    ]);
  });

  it("has no listed / sold / shipped columns and no later CRM tables", () => {
    expect(migrationSql).toContain("CREATE UNIQUE INDEX `cardflow_cards_language_tcgdex_id`");
    expect(migrationSql).toContain("`image_storage_ref`");
    expect(readFileSync(path.join(apiRoot, "drizzle/0001_crm_sessions.sql"), "utf8")).toContain(
      "`token_hash`",
    );
    expect(readFileSync(path.join(apiRoot, "drizzle/0002_pokecollector_user_map.sql"), "utf8")).toContain(
      "crm_pokecollector_users",
    );
    expect(readFileSync(path.join(apiRoot, "drizzle/0002_pokecollector_user_map.sql"), "utf8")).not.toMatch(
      /jwt|access_token|password/i,
    );
    expect(readFileSync(path.join(apiRoot, "drizzle/0003_grading_copies.sql"), "utf8")).toContain(
      "crm_grading_submitted",
    );
    expect(readFileSync(path.join(apiRoot, "drizzle/0003_grading_copies.sql"), "utf8")).toContain(
      "estimate_json",
    );
    expect(readFileSync(path.join(apiRoot, "drizzle/0003_grading_copies.sql"), "utf8")).not.toMatch(
      /`listed`|`sold`|psa_http|cert_lookup/i,
    );
    expect(migrationSql).toContain("`purchase_price` integer");
    expect(migrationSql).toContain("`asking_price` integer");
    expect(migrationSql).toContain("in ('user_entered', 'none')");
    expect(migrationSql).not.toContain("tcgdex_pricing");
    expect(migrationSql).not.toMatch(/`listed`/);
    expect(migrationSql).not.toMatch(/`sold`/);
    expect(migrationSql).not.toMatch(/`shipped`/);
    expect(migrationSql).not.toContain("crm_storage_locations");
    expect(migrationSql).not.toContain("crm_price_snapshots");
    expect(migrationSql).not.toContain("crm_audit_events");
  });
});
