import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it } from "vitest";
import { applyMvpMigrations, mvpMigrationsFolder } from "./migrate";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tmp = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cardflow-migr-"));
  dirs.push(dir);
  return dir;
};

type Journal = { entries: Array<{ idx: number; when: number; tag: string }> };
const journal = (): Journal => JSON.parse(readFileSync(path.join(mvpMigrationsFolder(), "meta/_journal.json"), "utf8")) as Journal;

/** A copy of the migrations folder that stops after `lastTag` (what an older deploy had). */
function foldersUpTo(lastTag: string): string {
  const dir = tmp();
  cpSync(mvpMigrationsFolder(), dir, { recursive: true });
  const j = journal();
  const cut = j.entries.findIndex((e) => e.tag === lastTag);
  writeFileSync(path.join(dir, "meta/_journal.json"), JSON.stringify({ ...j, entries: j.entries.slice(0, cut + 1) }));
  return dir;
}

describe("migrations 0000–0016", () => {
  it("journal is ordered: idx 0..16 in order, `when` strictly increasing, files exist", () => {
    const j = journal();
    expect(j.entries.map((e) => e.idx)).toEqual(Array.from({ length: 17 }, (_, i) => i));
    for (let i = 1; i < j.entries.length; i += 1) expect(j.entries[i]!.when).toBeGreaterThan(j.entries[i - 1]!.when);
    expect(j.entries.slice(14).map((e) => e.tag)).toEqual([
      "0014_accounts_guest_sessions",
      "0015_purchase_events_idempotency",
      "0016_quota_anchor_credits_period",
    ]);
    for (const e of j.entries) expect(readFileSync(path.join(mvpMigrationsFolder(), `${e.tag}.sql`), "utf8").length).toBeGreaterThan(0);
  });

  it("applies all of them to a fresh database", () => {
    const { sqlite } = applyMvpMigrations(path.join(tmp(), "fresh.sqlite"));
    const applied = sqlite.prepare("SELECT COUNT(*) AS n FROM __drizzle_migrations").get() as { n: number };
    expect(applied.n).toBe(17);
    sqlite.close();
  });

  it("upgrades a seeded 0013 database: purchases backfilled, usage and credits kept", () => {
    const file = path.join(tmp(), "seeded.sqlite");
    const old = new Database(file);
    old.pragma("foreign_keys = OFF");
    migrate(drizzle(old), { migrationsFolder: foldersUpTo("0013_grade_estimate_history") });
    const monthKey = new Date().toISOString().slice(0, 7);
    const now = new Date().toISOString();
    old.prepare(
      `INSERT INTO crm_inventory_items (inventory_item_id, user_id, cardflow_card_id, confirmation_id, intent, workflow_state, created_at, updated_at)
       VALUES ('inv-1', 'alex', 'card-1', 'conf-1', 'purchased', 'acquired', ?, ?)`,
    ).run(now, now);
    old.prepare(
      `INSERT INTO crm_purchases (purchase_id, inventory_item_id, purchased_at, currency, purchase_price, all_in_total)
       VALUES ('pur-1', 'inv-1', '2026-10-01T00:00:00.000Z', 'USD', 1000, 1200)`,
    ).run();
    old.prepare("INSERT INTO grade_accounts (user_id, plan, extra_credits, updated_at) VALUES ('alex', 'free', 4, '2026-09-20T00:00:00.000Z')").run();
    old.prepare("INSERT INTO grade_quota_usage (user_id, month_key, used) VALUES ('alex', ?, 3)").run(monthKey);
    old.prepare("INSERT INTO grade_quota_usage (user_id, month_key, used) VALUES ('jordan', ?, 2)").run(monthKey);
    old.close();

    const { sqlite } = applyMvpMigrations(file);
    const periodKey = `${monthKey}-01`;
    // 0015: the existing purchase is a "recorded" event with a snapshot.
    const events = sqlite.prepare("SELECT * FROM purchase_events").all() as Array<{ user_id: string; kind: string; purchased_at: string; snapshot: string }>;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ user_id: "alex", kind: "recorded", purchased_at: "2026-10-01T00:00:00.000Z" });
    expect(JSON.parse(events[0]!.snapshot)).toMatchObject({ purchasePrice: 1000, allInTotal: 1200 });
    // 0016 (M1): credits kept in the current period; this month's usage carried to the period key.
    const alex = sqlite.prepare("SELECT * FROM grade_accounts WHERE user_id = 'alex'").get() as { extra_credits: number; credits_period: string; anchor_at: string };
    expect(alex).toMatchObject({ extra_credits: 4, credits_period: periodKey, anchor_at: `${periodKey}T00:00:00.000Z` });
    const usage = (user: string) =>
      (sqlite.prepare("SELECT used FROM grade_quota_usage WHERE user_id = ? AND month_key = ?").get(user, periodKey) as { used: number } | undefined)?.used;
    expect(usage("alex")).toBe(3);
    expect(usage("jordan")).toBe(2);
    expect(sqlite.prepare("SELECT anchor_at FROM grade_accounts WHERE user_id = 'jordan'").get()).toEqual({ anchor_at: `${periodKey}T00:00:00.000Z` });
    expect((sqlite.prepare("SELECT COUNT(*) AS n FROM __drizzle_migrations").get() as { n: number }).n).toBe(17);
    sqlite.close();
  });
});
