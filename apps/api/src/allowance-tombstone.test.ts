import { createHash, createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AGE_GATE_VERSION, quotaAnchor, quotaPeriodFor } from "@cardflow/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
  ALLOWANCE_TOMBSTONE_TTL_MS,
  allowanceTombstoneKey,
  emailSendKey,
} from "./account-store";
import { createApp } from "./app";
import { createMemoryStore } from "./store";
import { createSqliteStore, type SqliteStorePort } from "./sqlite-store";
import { serverPepper } from "./server-pepper";

const PW = "correct horse battery";
const over18 = { ageConfirmed18Plus: true, ageGateVersion: AGE_GATE_VERSION };
const stores: SqliteStorePort[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type App = ReturnType<typeof createApp>;
async function call(app: App, pathName: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await app.request(pathName, {
    method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
    headers: {
      "content-type": "application/json",
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("allowance tombstone", () => {
  it("HMAC uses the server pepper and never looks like a plain SHA-256 of the email", () => {
    const a = allowanceTombstoneKey("Sean@Example.com");
    expect(a).toBe(allowanceTombstoneKey(" sean@example.com "));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(emailSendKey("sean@example.com"));
    expect(a).not.toBe(createHash("sha256").update("sean@example.com").digest("hex"));
    expect(a).toBe(
      createHmac("sha256", serverPepper()).update("cardflow-allowance-tombstone\0sean@example.com").digest("hex"),
    );
  });

  it("on delete stores HMAC + used for this period; re-sign-up carries used over (memory)", async () => {
    const store = createMemoryStore();
    const app = createApp(store, { devAutoSession: false, guestMode: true, orphanSweepIntervalMs: 0 });
    const up = await call(app, "/v1/accounts", { body: { email: "back@example.com", password: PW, ...over18 } });
    expect(up.status).toBe(200);
    const token = up.body.token as string;
    const userId = (up.body.identity as { userId: string }).userId;
    store.ensureGradeAnchor(userId, new Date().toISOString());
    // Match app.ts quotaPeriodForUser: calendar month unless a billing date is set.
    const account = store.getGradeAccount(userId);
    const period = quotaPeriodFor(
      quotaAnchor({ billingAnchorAt: account.billingAnchorAt, createdAt: account.anchorAt ?? new Date().toISOString() }),
      new Date(),
    );
    store.setGradeQuotaUsage(userId, period.key, 2);
    expect(store.getGradeQuotaUsage(userId, period.key)).toBe(2);

    expect((await call(app, "/v1/account/delete", { method: "POST", token, body: { password: PW } })).status).toBe(200);
    const tomb = store.accounts.findAllowanceTombstone(allowanceTombstoneKey("back@example.com"));
    expect(tomb).toMatchObject({ periodKey: period.key, used: 2 });
    expect(tomb!.emailHmac).not.toContain("back@");
    expect(store.accounts.getAccount(userId)).toBeNull();

    const again = await call(app, "/v1/accounts", { body: { email: "back@example.com", password: PW, ...over18 } });
    expect(again.status).toBe(200);
    const newId = (again.body.identity as { userId: string }).userId;
    expect(newId).not.toBe(userId);
    expect(store.getGradeQuotaUsage(newId, period.key)).toBe(2);
    expect(store.getGradeAccount(newId).extraCredits).toBe(0);
  });

  it("purge drops tombstones older than 90 days via the orphan sweep", async () => {
    let sweep!: () => { accountsSwept: number; imagesSwept: number };
    const now = new Date("2026-10-18T12:00:00.000Z");
    const store = createMemoryStore();
    createApp(store, {
      now: () => now,
      orphanSweepIntervalMs: 0,
      onOrphanSweep: (run) => {
        sweep = run;
      },
    });
    store.accounts.upsertAllowanceTombstone({
      emailHmac: allowanceTombstoneKey("old@example.com"),
      periodKey: "2026-07-01",
      used: 3,
      deletedAt: new Date(now.getTime() - ALLOWANCE_TOMBSTONE_TTL_MS - 1000).toISOString(),
    });
    store.accounts.upsertAllowanceTombstone({
      emailHmac: allowanceTombstoneKey("fresh@example.com"),
      periodKey: "2026-10-01",
      used: 1,
      deletedAt: now.toISOString(),
    });
    sweep();
    expect(store.accounts.findAllowanceTombstone(allowanceTombstoneKey("old@example.com"))).toBeNull();
    expect(store.accounts.findAllowanceTombstone(allowanceTombstoneKey("fresh@example.com"))?.used).toBe(1);
  });

  it("sqlite: tombstone survives delete and restores usage on sign-up", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cardflow-tomb-"));
    dirs.push(dir);
    const store = createSqliteStore({ sqlitePath: path.join(dir, "db.sqlite") });
    stores.push(store);
    const app = createApp(store, { devAutoSession: false, guestMode: false, orphanSweepIntervalMs: 0 });
    const up = await call(app, "/v1/accounts", { body: { email: "sql@example.com", password: PW, ...over18 } });
    expect(up.status).toBe(200);
    const token = up.body.token as string;
    const userId = (up.body.identity as { userId: string }).userId;
    store.ensureGradeAnchor(userId, new Date().toISOString());
    const account = store.getGradeAccount(userId);
    const period = quotaPeriodFor(
      quotaAnchor({ billingAnchorAt: account.billingAnchorAt, createdAt: account.anchorAt ?? new Date().toISOString() }),
      new Date(),
    );
    store.setGradeQuotaUsage(userId, period.key, 4);
    expect((await call(app, "/v1/account/delete", { method: "POST", token, body: { password: PW } })).status).toBe(200);
    expect(store.accounts.findAllowanceTombstone(allowanceTombstoneKey("sql@example.com"))?.used).toBe(4);
    const again = await call(app, "/v1/accounts", { body: { email: "sql@example.com", password: PW, ...over18 } });
    expect(again.status).toBe(200);
    expect(store.getGradeQuotaUsage((again.body.identity as { userId: string }).userId, period.key)).toBe(4);
  });
});
