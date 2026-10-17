import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { mockCardRecognitionProvider, type CardRecognitionProvider } from "@cardflow/shared";
import { afterEach, describe, expect, it } from "vitest";
import { emailSendKey } from "./account-store";
import { createApp } from "./app";
import { createIdempotencyRegistry } from "./idempotency";
import { createSqliteStore, type SqliteStorePort } from "./sqlite-store";

/** P4: account deletion end to end, for every kind of session the app can hold. */
const stores: SqliteStorePort[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Options = NonNullable<Parameters<typeof createApp>[1]>;
function open(extra: Partial<Options> = {}, sqlitePath = ":memory:") {
  const store = createSqliteStore({ sqlitePath });
  stores.push(store);
  return { store, app: createApp(store, { devAutoSession: false, guestMode: true, orphanSweepIntervalMs: 0, ...extra }) };
}
function openOnDisk(extra: Partial<Options> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "cardflow-delete-"));
  dirs.push(dir);
  const sqlitePath = path.join(dir, "cardflow.sqlite");
  return { ...open(extra, sqlitePath), dir, sqlitePath };
}

type App = ReturnType<typeof createApp>;
async function call(app: App, url: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await app.request(url, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: {
      "content-type": "application/json",
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const PW = "correct horse battery";
const remaining = (rows: Record<string, number>) => Object.entries(rows).filter(([, n]) => n > 0);
async function signUp(app: App, email: string) {
  const up = await call(app, "/v1/accounts", { body: { email, password: PW, ageConfirmed18Plus: true } });
  expect(up.status).toBe(200);
  return { token: up.body.token as string, userId: (up.body.identity as { userId: string }).userId };
}
const deleteWith = (app: App, token: string, password?: string) =>
  call(app, "/v1/account/delete", { method: "POST", token, body: password === undefined ? {} : { password } });

describe("P4 account deletion end to end", () => {
  it("a guest can delete their guest data now (not only after 24 hours), no password needed", async () => {
    const { app, store } = open();
    const guest = await call(app, "/v1/sessions/guest", { method: "POST" });
    const token = guest.body.token as string;
    const userId = (guest.body.identity as { userId: string }).userId;
    await call(app, "/v1/scans", { body: { captureMethod: "camera_photo", scenario: "high-confidence" }, token });
    expect(store.accounts.countUserRows(userId).crm_scans).toBe(1);
    const deleted = await call(app, "/v1/account/delete", { method: "POST", token });
    expect(deleted.status).toBe(200);
    expect(deleted.body.ok).toBe(true);
    expect(remaining(store.accounts.countUserRows(userId))).toEqual([]);
    expect((await call(app, "/v1/inventory", { token })).status).toBe(401);
  });

  it("an unverified account can delete itself with its password, and the email is free again", async () => {
    const { app, store } = open();
    const { token, userId } = await signUp(app, "gone@example.com");
    const deleted = await deleteWith(app, token, PW);
    expect(deleted.status).toBe(200);
    expect(remaining(store.accounts.countUserRows(userId))).toEqual([]);
    // Signed out everywhere, password gone, email reusable.
    expect((await call(app, "/v1/identity", { token })).status).toBe(401);
    expect((await call(app, "/v1/sessions/password", { body: { email: "gone@example.com", password: PW } })).status).toBe(401);
    const again = await signUp(app, "gone@example.com");
    expect(again.userId).not.toBe(userId);
  });

  it("M4: an account with a password must send the right one; nothing is deleted otherwise", async () => {
    const { app, store } = open();
    const { token, userId } = await signUp(app, "pw@example.com");
    const missing = await deleteWith(app, token);
    expect(missing.status).toBe(403);
    expect(missing.body.code).toBe("password_required");
    const wrong = await deleteWith(app, token, "not the password");
    expect(wrong.status).toBe(403);
    expect(wrong.body.code).toBe("password_incorrect");
    // Never 401 (the app reads 401 as "already gone") and never the raw hash or email.
    expect(JSON.stringify(wrong.body)).not.toMatch(/pw@example|scrypt/);
    expect(store.accounts.getAccount(userId)).not.toBeNull();
    expect((await call(app, "/v1/identity", { token })).status).toBe(200);
    expect((await deleteWith(app, token, PW)).status).toBe(200);
    expect(store.accounts.getAccount(userId)).toBeNull();
  });

  it("M4: wrong passwords are rate-limited per account", async () => {
    const { app } = open();
    const { token } = await signUp(app, "limit@example.com");
    for (let i = 0; i < 10; i += 1) expect((await deleteWith(app, token, `wrong-${i}`)).status).toBe(403);
    expect((await deleteWith(app, token, PW)).status).toBe(429);
  });

  it("H1: a retried delete with the same token gets 410 (receipt), other dead tokens 401", async () => {
    const { app } = open();
    const { token } = await signUp(app, "retry@example.com");
    const second = (await call(app, "/v1/sessions/password", { body: { email: "retry@example.com", password: PW } })).body.token as string;
    expect((await deleteWith(app, token, PW)).status).toBe(200);
    const retry = await deleteWith(app, token, PW);
    expect(retry.status).toBe(410);
    expect(retry.body.code).toBe("account_deleted");
    expect(JSON.stringify(retry.body)).not.toContain("retry@example.com");
    // The other session was signed out but did not delete; it gets a plain 401.
    expect((await deleteWith(app, second, PW)).status).toBe(401);
    // Only the delete route answers 410; everything else is 401.
    expect((await call(app, "/v1/inventory", { token })).status).toBe(401);
  });

  it("without a session there is nothing to delete", async () => {
    const { app } = open();
    expect((await call(app, "/v1/account/delete", { method: "POST" })).status).toBe(401);
  });

  // PokéCollector deletion (queued, background, retries): pokecollector-deletion-queue.test.ts.

  it("L3: each delete leaves one audit row with no user ID, email or token", async () => {
    const { app, store } = open();
    const { token, userId } = await signUp(app, "audit@example.com");
    expect((await deleteWith(app, token, PW)).status).toBe(200);
    const audit = store.accounts.listDeletionAudit();
    expect(audit).toHaveLength(1);
    expect(audit[0]!.kind).toBe("self");
    expect(audit[0]!.rowsDeleted).toBeGreaterThan(0);
    expect(Object.keys(audit[0]!).sort()).toEqual(["at", "kind", "rowsDeleted"]);
    const json = JSON.stringify(audit);
    for (const secret of [userId, "audit@example.com", token]) expect(json).not.toContain(secret);
  });

  it("L1: email_send_counts keeps a hash of the address, never the address", async () => {
    const { app, store, sqlitePath } = openOnDisk();
    await signUp(app, "Hash.Me@Example.com");
    expect(store.accounts.takeEmailSendForAddress("Hash.Me@Example.com", "2026-10-17", 10)).toBe(true);
    const raw = new Database(sqlitePath, { readonly: true });
    try {
      const rows = raw.prepare("SELECT email FROM email_send_counts").all() as Array<{ email: string }>;
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.email).not.toContain("@");
        expect(row.email).toBe(emailSendKey("hash.me@example.com"));
      }
    } finally {
      raw.close();
    }
    expect(emailSendKey(" HASH.me@example.com ")).toBe(emailSendKey("hash.me@example.com"));
    expect(emailSendKey("a@example.com")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("L1: the replay cache is purged per user prefix", () => {
    const registry = createIdempotencyRegistry<string>(() => 0);
    registry.claim("u1\0a");
    registry.claim("u1\0b");
    registry.claim("u2\0a");
    expect(registry.purgePrefix("u1\0")).toBe(2);
    expect(registry.peek("u1\0a")).toBe(false);
    expect(registry.peek("u2\0a")).toBe(true);
  });
});

describe("Backend review M1: in-flight scans and orphan sweep", () => {
  it("a scan that finishes after its account was deleted is dropped (410), and no row is written", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let started!: () => void;
    const startedP = new Promise<void>((resolve) => (started = resolve));
    const slow: CardRecognitionProvider = {
      ...mockCardRecognitionProvider,
      async identifyCard(request) {
        started();
        await gate;
        return mockCardRecognitionProvider.identifyCard(request);
      },
    };
    const { app, store } = open({ recognition: slow, allowDevScenario: true });
    const { token, userId } = await signUp(app, "inflight@example.com");
    const pending = call(app, "/v1/scans", { body: { captureMethod: "camera_photo", scenario: "high-confidence" }, token });
    await startedP;
    expect((await deleteWith(app, token, PW)).status).toBe(200);
    release();
    const res = await pending;
    expect(res.status).toBe(410);
    expect(res.body.code).toBe("account_deleted");
    expect(store.listScans(userId)).toEqual([]);
    expect(remaining(store.accounts.countUserRows(userId))).toEqual([]);
  });

  it("the temp image of a dropped scan is removed (discardScanImage)", () => {
    const { store, dir } = openOnDisk();
    const scanId = "66666666-6666-6666-6666-666666666666";
    const saved = store.saveScanImage(scanId, { bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), mimeType: "image/jpeg" });
    const file = path.join(dir, saved.storageRef);
    expect(existsSync(file)).toBe(true);
    // Only that scan's own first-party file.
    expect(store.discardScanImage("77777777-7777-7777-7777-777777777777", saved.storageRef)).toBe(false);
    expect(store.discardScanImage(scanId, "../cardflow.sqlite")).toBe(false);
    expect(store.discardScanImage(scanId, saved.storageRef)).toBe(true);
    expect(existsSync(file)).toBe(false);
  });

  it("sweeps scan rows of accounts that no longer exist and old orphan image files, never testers", async () => {
    let sweep!: () => { accountsSwept: number; imagesSwept: number };
    const { app, store, dir } = openOnDisk({ onOrphanSweep: (run) => (sweep = run) });
    void app;
    const tester = store.listInvitedUsers()[0]!.userId;
    const base = { capturedAt: "2026-10-17T00:00:00.000Z", captureMethod: "camera_photo", scenario: "high-confidence", preInventoryState: "scan_captured", cardflowCardId: null, confirmationId: null, inventoryItemId: null, imageStorageRef: null, imageMimeType: null, idempotencyBodyHash: null, recognition: { provider: "mock", candidates: [] }, mapping: { provider: "mock", canonicalCard: null, candidates: [] } };
    store.saveScan({ ...base, scanId: "11111111-1111-1111-1111-111111111111", userId: "acct_ghost" } as never);
    store.saveScan({ ...base, scanId: "22222222-2222-2222-2222-222222222222", userId: tester } as never);
    mkdirSync(path.join(dir, "scans"), { recursive: true });
    const oldOrphan = path.join(dir, "scans", "33333333-3333-3333-3333-333333333333.jpg");
    const newOrphan = path.join(dir, "scans", "44444444-4444-4444-4444-444444444444.jpg");
    writeFileSync(oldOrphan, "x");
    writeFileSync(newOrphan, "x");
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(oldOrphan, twoHoursAgo, twoHoursAgo);
    expect(sweep()).toEqual({ accountsSwept: 1, imagesSwept: 1 });
    expect(store.listScans("acct_ghost")).toEqual([]);
    expect(store.listScans(tester)).toHaveLength(1);
    expect(existsSync(oldOrphan)).toBe(false);
    // A file younger than an hour may belong to a scan still in flight.
    expect(existsSync(newOrphan)).toBe(true);
    expect(store.accounts.listDeletionAudit().map((a) => a.kind)).toEqual(["orphan_sweep"]);
  });
});

describe("Backend review M5: every user table and file on a real temp-dir store", () => {
  /** Values for columns with CHECK constraints; everything else gets a type-shaped dummy. */
  const CHECKED: Record<string, unknown> = {
    intent: "purchased",
    workflow_state: "acquired",
    plan: "free",
    provider: "cardsight",
    age_confirmed_18plus: 1,
    reference_price_source: "none",
    side: "front",
    via: "candidate",
    status: "draft",
  };
  const KIND: Record<string, string> = { purchase_events: "recorded", consent_events: "grant" };

  it("seeds a row in every user_id table plus photos, deletes, and leaves nothing tied to the user", async () => {
    const { app, store, dir, sqlitePath } = openOnDisk();
    const { token, userId } = await signUp(app, "everything@example.com");
    const scanId = "55555555-5555-5555-5555-555555555555";
    const itemId = "inv-everything";
    const purchaseId = "purchase-everything";

    const raw = new Database(sqlitePath);
    raw.pragma("foreign_keys = OFF");
    const tables = (
      raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'").all() as Array<{ name: string }>
    ).map((t) => t.name);
    const seeded: string[] = [];
    for (const table of tables) {
      const cols = raw.prepare(`PRAGMA table_info(\`${table}\`)`).all() as Array<{ name: string; type: string; notnull: number; dflt_value: unknown; pk: number }>;
      if (!cols.some((c) => c.name === "user_id")) continue;
      const already = (raw.prepare(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE user_id = ?`).get(userId) as { n: number }).n;
      if (already > 0) {
        seeded.push(table);
        continue;
      }
      const values: Record<string, unknown> = {};
      for (const col of cols) {
        if (col.name === "user_id") values[col.name] = userId;
        else if (col.name === "kind") values[col.name] = KIND[table] ?? "grant";
        else if (col.name in CHECKED) values[col.name] = CHECKED[col.name];
        else if (col.name === "scan_id") values[col.name] = scanId;
        else if (col.name === "inventory_item_id") values[col.name] = itemId;
        else if (col.name === "purchase_id") values[col.name] = purchaseId;
        else if (col.name === "image_storage_ref") values[col.name] = `scans/${scanId}.jpg`;
        else if (col.name === "image_mime_type") values[col.name] = "image/jpeg";
        else if (col.name === "purchased_at" || col.name === "captured_at") values[col.name] = "2026-10-14T00:00:00.000Z";
        else if (col.pk && /INT/i.test(col.type)) continue;
        else if (!col.notnull && col.dflt_value === null) continue;
        else if (/INT|REAL/i.test(col.type)) values[col.name] = 1;
        else values[col.name] = `${table}-${col.name}`;
      }
      const names = Object.keys(values);
      raw.prepare(`INSERT INTO \`${table}\` (${names.map((n) => `\`${n}\``).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`).run(
        ...names.map((n) => values[n] as never),
      );
      seeded.push(table);
    }
    // Child rows with no user_id of their own: the purchase under the seeded inventory item.
    const purchaseCols = raw.prepare("PRAGMA table_info(`crm_purchases`)").all() as Array<{ name: string; type: string; notnull: number; dflt_value: unknown }>;
    const pv: Record<string, unknown> = {};
    for (const col of purchaseCols) {
      if (col.name === "purchase_id") pv[col.name] = purchaseId;
      else if (col.name === "inventory_item_id") pv[col.name] = itemId;
      else if (col.name in CHECKED) pv[col.name] = CHECKED[col.name];
      else if (!col.notnull || col.dflt_value !== null) continue;
      else pv[col.name] = /INT|REAL/i.test(col.type) ? 1 : "2026-10-17T00:00:00.000Z";
    }
    raw.prepare(`INSERT INTO crm_purchases (${Object.keys(pv).join(", ")}) VALUES (${Object.keys(pv).map(() => "?").join(", ")})`).run(
      ...Object.values(pv).map((v) => v as never),
    );
    raw.close();

    // Photos on disk: the scan still and both grade sides.
    const files = [`scans/${scanId}.jpg`, `grade/${itemId}-front.jpg`, `grade/${itemId}-back.png`].map((ref) => path.join(dir, ref));
    for (const file of files) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, "photo");
    }

    const before = store.accounts.countUserRows(userId);
    const userTables = Object.keys(before);
    expect(userTables.length).toBeGreaterThan(20);
    for (const table of userTables) expect(before[table], `${table} seeded`).toBeGreaterThan(0);
    expect(seeded.sort()).toEqual([...userTables].sort());

    expect((await deleteWith(app, token, PW)).status).toBe(200);

    expect(remaining(store.accounts.countUserRows(userId))).toEqual([]);
    for (const file of files) expect(existsSync(file), file).toBe(false);
    const check = new Database(sqlitePath, { readonly: true });
    try {
      // purchase_events: nothing under the user ID, and no row points at their purchase or item.
      const tied = check
        .prepare("SELECT COUNT(*) AS n FROM purchase_events WHERE user_id = ? OR purchase_id = ? OR inventory_item_id = ? OR snapshot IS NOT NULL")
        .get(userId, purchaseId, itemId) as { n: number };
      expect(tied.n).toBe(0);
      // H2: purchase_events rows are hard-deleted; only anonymous weekly totals remain.
      expect((check.prepare("SELECT COUNT(*) AS n FROM purchase_events").get() as { n: number }).n).toBe(0);
      const totals = check.prepare("SELECT * FROM north_star_weekly_totals").all() as Array<Record<string, unknown>>;
      expect(totals).toEqual([{ week_start: "2026-10-12", purchased: 1, scans: 1, active_resellers: 1 }]);
      for (const row of totals) expect(Object.keys(row).sort()).toEqual(["active_resellers", "purchased", "scans", "week_start"]);
      expect((check.prepare("SELECT COUNT(*) AS n FROM crm_purchases WHERE purchase_id = ?").get(purchaseId) as { n: number }).n).toBe(0);
      const audit = check.prepare("SELECT * FROM account_deletion_audit").all();
      expect(JSON.stringify(audit)).not.toContain(userId);
    } finally {
      check.close();
    }
  });
});

describe("Backend re-review (P4): sweep scope, memory image cutoff, peppered email keys", () => {
  it("M1: the orphan sweep finds a deleted account's rows in any user_id table, not only scans", async () => {
    let sweep!: () => { accountsSwept: number; imagesSwept: number };
    const { store } = open({ onOrphanSweep: (run) => (sweep = run) });
    // No scan at all: only a preferences row and a consent row for an account that's gone.
    store.setPreferences("acct_ghost2", { ...store.getPreferences("acct_ghost2") });
    store.consents.decline("acct_ghost2", "cardsight", "v1", "2026-10-17T00:00:00.000Z");
    expect(store.listScanUserIds("")).not.toContain("acct_ghost2");
    expect(store.accounts.listAllUserIds()).toContain("acct_ghost2");
    expect(sweep().accountsSwept).toBe(1);
    expect(remaining(store.accounts.countUserRows("acct_ghost2"))).toEqual([]);
  });

  it("edge: sweeping a deleted account's stray purchase adds the purchase but not a second active reseller", async () => {
    let sweep!: () => { accountsSwept: number; imagesSwept: number };
    const { app, store } = open({ onOrphanSweep: (run) => (sweep = run) });
    const { token, userId } = await signUp(app, "stray@example.com");
    const at = new Date().toISOString();
    store.purchaseLedger.record(userId, { purchaseId: "p1", inventoryItemId: "i1", purchasedAt: at, snapshot: null, at });
    expect((await deleteWith(app, token, PW)).status).toBe(200);
    const after = store.accounts.listNorthStarTotals();
    expect(after).toEqual([expect.objectContaining({ purchased: 1, activeResellers: 1 })]);
    // A purchase that was in flight lands after the delete, in the same week.
    store.purchaseLedger.record(userId, { purchaseId: "p2", inventoryItemId: "i2", purchasedAt: at, snapshot: null, at });
    expect(sweep().accountsSwept).toBe(1);
    expect(store.purchaseLedger.list(userId)).toEqual([]);
    expect(store.accounts.listNorthStarTotals()).toEqual([expect.objectContaining({ weekStart: after[0]!.weekStart, purchased: 2, activeResellers: 1 })]);
  });

  it("L4: the weekly counts are read inside the delete's transaction", async () => {
    const { applyMvpMigrations } = await import("./db/migrate");
    const { createSqliteAccountStore } = await import("./account-store");
    const { sqlite, db } = applyMvpMigrations(":memory:");
    const accounts = createSqliteAccountStore(sqlite, db);
    let inTransaction: boolean | null = null;
    accounts.deleteAllUserRows("acct_x", {
      northStarTotals: () => {
        inTransaction = sqlite.inTransaction;
        return [{ weekStart: "2026-10-12", purchased: 1, scans: 0, activeResellers: 1 }];
      },
    });
    expect(inTransaction).toBe(true);
    expect(accounts.listNorthStarTotals()).toEqual([{ weekStart: "2026-10-12", purchased: 1, scans: 0, activeResellers: 1 }]);
    sqlite.close();
  });

  it("L1: in memory-image mode the sweep also leaves images younger than an hour", async () => {
    let sweep!: () => { accountsSwept: number; imagesSwept: number };
    const { store } = open({ onOrphanSweep: (run) => (sweep = run) });
    const scanId = "88888888-8888-8888-8888-888888888888";
    store.saveScanImage(scanId, { bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), mimeType: "image/jpeg" });
    expect(sweep().imagesSwept).toBe(0);
    // An hour later it is an orphan.
    expect(store.sweepOrphanScanImages(new Date(Date.now() + 60 * 60 * 1000 + 1))).toBe(1);
  });

  it("L3: email_send_counts keys are HMAC-SHA256 with the server pepper", async () => {
    const { createHmac } = await import("node:crypto");
    const { serverPepper } = await import("./server-pepper");
    const pepper = serverPepper();
    expect(emailSendKey("a@example.com")).toBe(
      createHmac("sha256", pepper).update("cardflow-email-send\0a@example.com").digest("hex"),
    );
    expect(emailSendKey("a@example.com", "another-pepper-another-pepper-xx")).not.toBe(emailSendKey("a@example.com"));
    // Without the pepper the plain hash of the address doesn't match.
    const { createHash } = await import("node:crypto");
    expect(emailSendKey("a@example.com")).not.toBe(createHash("sha256").update("cardflow-email-send\0a@example.com").digest("hex"));
    expect(() => serverPepper({ NODE_ENV: "production" })).toThrow(/CARD_FLOW_SERVER_PEPPER/);
    expect(() => serverPepper({ NODE_ENV: "production", CARD_FLOW_SERVER_PEPPER: "short" })).toThrow();
    expect(serverPepper({ NODE_ENV: "production", CARD_FLOW_SERVER_PEPPER: "p".repeat(32) })).toBe("p".repeat(32));
    const { productionConfigProblems } = await import("./production-config");
    expect(productionConfigProblems({ NODE_ENV: "production", CARD_FLOW_TRUST_PROXY_HOPS: "1" }).join(" ")).toContain("CARD_FLOW_SERVER_PEPPER");
  });
});
