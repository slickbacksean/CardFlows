import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it } from "vitest";
import { quotaPeriodFor } from "@cardflow/shared";
import { applyMvpMigrations, mvpMigrationsFolder } from "./migrate";
import { backfillQuotaAnchors } from "./quota-anchor-backfill";

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

describe("migrations 0000–0017", () => {
  it("journal is ordered: idx 0..17 in order, `when` strictly increasing, files exist", () => {
    const j = journal();
    expect(j.entries.map((e) => e.idx)).toEqual(Array.from({ length: 18 }, (_, i) => i));
    for (let i = 1; i < j.entries.length; i += 1) expect(j.entries[i]!.when).toBeGreaterThan(j.entries[i - 1]!.when);
    expect(j.entries.slice(14).map((e) => e.tag)).toEqual([
      "0014_accounts_guest_sessions",
      "0015_purchase_events_idempotency",
      "0016_quota_anchor_credits_period",
      "0017_email_verification",
    ]);
    for (const e of j.entries) expect(readFileSync(path.join(mvpMigrationsFolder(), `${e.tag}.sql`), "utf8").length).toBeGreaterThan(0);
  });

  it("applies all of them to a fresh database", () => {
    const { sqlite } = applyMvpMigrations(path.join(tmp(), "fresh.sqlite"));
    const applied = sqlite.prepare("SELECT COUNT(*) AS n FROM __drizzle_migrations").get() as { n: number };
    expect(applied.n).toBe(18);
    sqlite.close();
  });

  it("upgrades a seeded 0013 database: purchases backfilled, usage and credits kept", () => {
    const file = path.join(tmp(), "seeded.sqlite");
    const old = new Database(file);
    old.pragma("foreign_keys = OFF");
    migrate(drizzle(old), { migrationsFolder: foldersUpTo("0013_grade_estimate_history") });
    const monthKey = new Date().toISOString().slice(0, 7);
    const now = new Date().toISOString();
    // Alex's earliest activity: 20 days ago, so his in-progress period started then, not on the 1st.
    const alexFirstSeen = new Date(Date.now() - 20 * 86_400_000).toISOString();
    old.prepare(
      `INSERT INTO crm_inventory_items (inventory_item_id, user_id, cardflow_card_id, confirmation_id, intent, workflow_state, created_at, updated_at)
       VALUES ('inv-1', 'alex', 'card-1', 'conf-1', 'purchased', 'acquired', ?, ?)`,
    ).run(alexFirstSeen, now);
    old.prepare(
      `INSERT INTO crm_purchases (purchase_id, inventory_item_id, purchased_at, currency, purchase_price, all_in_total)
       VALUES ('pur-1', 'inv-1', '2026-10-01T00:00:00.000Z', 'USD', 1000, 1200)`,
    ).run();
    old.prepare("INSERT INTO grade_accounts (user_id, plan, extra_credits, updated_at) VALUES ('alex', 'free', 4, '2026-09-20T00:00:00.000Z')").run();
    old.prepare("INSERT INTO grade_quota_usage (user_id, month_key, used) VALUES ('alex', ?, 3)").run(monthKey);
    old.prepare("INSERT INTO grade_quota_usage (user_id, month_key, used) VALUES ('jordan', ?, 2)").run(monthKey);
    old.close();

    const { sqlite } = applyMvpMigrations(file);
    const alexPeriod = quotaPeriodFor(alexFirstSeen, new Date());
    const jordanAnchor = `${monthKey}-01T00:00:00.000Z`; // only usage this month is known
    // 0015: the existing purchase is a "recorded" event with a snapshot.
    const events = sqlite.prepare("SELECT * FROM purchase_events").all() as Array<{ user_id: string; kind: string; purchased_at: string; snapshot: string }>;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ user_id: "alex", kind: "recorded", purchased_at: "2026-10-01T00:00:00.000Z" });
    expect(JSON.parse(events[0]!.snapshot)).toMatchObject({ purchasePrice: 1000, allInTotal: 1200 });
    // 0016 (M1): anchored on the earliest known activity (not the 1st); credits and this month's
    // usage carried into the in-progress period.
    const alex = sqlite.prepare("SELECT * FROM grade_accounts WHERE user_id = 'alex'").get() as { extra_credits: number; credits_period: string; anchor_at: string };
    expect(alex).toMatchObject({ extra_credits: 4, credits_period: alexPeriod.key, anchor_at: alexFirstSeen });
    const usage = (user: string, key: string) =>
      (sqlite.prepare("SELECT used FROM grade_quota_usage WHERE user_id = ? AND month_key = ?").get(user, key) as { used: number } | undefined)?.used;
    expect(usage("alex", alexPeriod.key)).toBe(3);
    expect(sqlite.prepare("SELECT anchor_at FROM grade_accounts WHERE user_id = 'jordan'").get()).toEqual({ anchor_at: jordanAnchor });
    expect(usage("jordan", quotaPeriodFor(jordanAnchor, new Date()).key)).toBe(2);
    expect((sqlite.prepare("SELECT COUNT(*) AS n FROM __drizzle_migrations").get() as { n: number }).n).toBe(18);
    sqlite.close();
  });

  it("backfill: creation date, else earliest activity, else first usage month; usage and credits kept", () => {
    const sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = OFF");
    migrate(drizzle(sqlite), { migrationsFolder: mvpMigrationsFolder() }); // raw migrate: no backfill yet
    const addScan = (id: string, user: string, at: string) =>
      sqlite.prepare("INSERT INTO crm_scans (scan_id, user_id, captured_at, capture_method, recognition_json) VALUES (?, ?, ?, 'camera', '{}')").run(id, user, at);
    const account = sqlite.prepare("INSERT INTO grade_accounts (user_id, plan, extra_credits, updated_at) VALUES (?, 'free', ?, '2026-10-10T00:00:00.000Z')");
    const use = sqlite.prepare("INSERT INTO grade_quota_usage (user_id, month_key, used) VALUES (?, ?, ?)");
    // sam signed up Mar 20 (a guest scan before that doesn't count: creation date wins).
    sqlite.prepare("INSERT INTO user_accounts (user_id, email, password_hash, created_at) VALUES ('sam', 'sam@x.test', 'h', '2026-03-20T09:00:00.000Z')").run();
    addScan("s0", "sam", "2026-02-01T00:00:00.000Z");
    account.run("sam", 2);
    use.run("sam", "2026-10", 3);
    // tess (invited tester, no sign-up): earliest scan May 5.
    addScan("t1", "tess", "2026-06-01T00:00:00.000Z");
    addScan("t0", "tess", "2026-05-05T08:00:00.000Z");
    account.run("tess", 0);
    use.run("tess", "2026-10", 5);
    // uma: only usage rows; earliest month July.
    account.run("uma", 0);
    use.run("uma", "2026-07", 1);
    use.run("uma", "2026-10", 4);
    // vic already has an anchor: untouched.
    account.run("vic", 0);
    sqlite.prepare("UPDATE grade_accounts SET anchor_at = '2026-01-15T00:00:00.000Z' WHERE user_id = 'vic'").run();

    const now = new Date("2026-10-16T12:00:00.000Z");
    expect(backfillQuotaAnchors(sqlite, now)).toBe(3);
    const row = (u: string) => sqlite.prepare("SELECT anchor_at, credits_period, extra_credits FROM grade_accounts WHERE user_id = ?").get(u);
    const used = (u: string, k: string) => (sqlite.prepare("SELECT used FROM grade_quota_usage WHERE user_id = ? AND month_key = ?").get(u, k) as { used: number } | undefined)?.used;
    expect(row("sam")).toEqual({ anchor_at: "2026-03-20T09:00:00.000Z", credits_period: "2026-09-20", extra_credits: 2 });
    expect(used("sam", "2026-09-20")).toBe(3);
    expect(row("tess")).toMatchObject({ anchor_at: "2026-05-05T08:00:00.000Z", credits_period: "2026-10-05" });
    expect(used("tess", "2026-10-05")).toBe(5);
    expect(row("uma")).toMatchObject({ anchor_at: "2026-07-01T00:00:00.000Z", credits_period: "2026-10-01" });
    expect(used("uma", "2026-10-01")).toBe(4);
    expect(row("vic")).toMatchObject({ anchor_at: "2026-01-15T00:00:00.000Z", credits_period: null });
    // Nobody is anchored to the deploy month's 1st unless that's their real history; reruns are no-ops.
    expect(quotaPeriodFor("2026-03-20T09:00:00.000Z", now).resetsAt).toBe("2026-10-20T09:00:00.000Z");
    expect(backfillQuotaAnchors(sqlite, now)).toBe(0);
    sqlite.close();
  });

  it("0017 (M3): only accounts created before open sign-up deployed (03:01 UTC Oct 17) count as verified", () => {
    const file = path.join(tmp(), "pre-0017.sqlite");
    const old = new Database(file);
    old.pragma("foreign_keys = OFF");
    migrate(drizzle(old), { migrationsFolder: foldersUpTo("0016_quota_anchor_credits_period") });
    const add = old.prepare("INSERT INTO user_accounts (user_id, email, password_hash, created_at) VALUES (?, ?, 'h', ?)");
    add.run("acct_old", "old@x.test", "2026-10-17T03:00:59.000Z");
    add.run("acct_after", "after@x.test", "2026-10-17T03:01:00.000Z");
    old.close();
    const { sqlite } = applyMvpMigrations(file);
    const verifiedAt = (id: string) => (sqlite.prepare("SELECT email_verified_at AS v FROM user_accounts WHERE user_id = ?").get(id) as { v: string | null }).v;
    expect(verifiedAt("acct_old")).toBe("2026-10-17T03:00:59.000Z");
    expect(verifiedAt("acct_after")).toBeNull();
    expect(sqlite.prepare("SELECT verification_sends AS n FROM user_accounts WHERE user_id = 'acct_old'").get()).toEqual({ n: 0 });
    sqlite.close();
  });

});
