import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createSqliteStore } from "./sqlite-store";
import { createMemoryStore, type StorePort } from "./store";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function purchase(app: ReturnType<typeof createApp>, withPrice: boolean) {
  const scan = (await (
    await app.request("/v1/scans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ captureMethod: "camera_photo", scenario: "high-confidence" }),
    })
  ).json()) as { scan: { scanId: string } };
  const confirmed = (await (
    await app.request(`/v1/scans/${scan.scan.scanId}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tcgdexId: "base1-58" }),
    })
  ).json()) as { confirmation: { confirmationId: string } };
  const res = await app.request("/v1/inventory/purchased", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      confirmationId: confirmed.confirmation.confirmationId,
      ...(withPrice
        ? { purchasePrice: "5", purchasedAt: new Date().toISOString() }
        : { detailsNeeded: true, platform: "whatnot", streamUrl: "https://www.whatnot.com" }),
    }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { item: { inventoryItemId: string } }).item.inventoryItemId;
}

const stores: Array<[string, () => StorePort]> = [
  ["memory", () => createMemoryStore()],
  [
    "sqlite",
    () => {
      const dir = mkdtempSync(path.join(tmpdir(), "cardflow-ledger-"));
      dirs.push(dir);
      return createSqliteStore({ sqlitePath: path.join(dir, "db.sqlite") });
    },
  ],
];

describe("purchase ledger rules", () => {
  it("records once, appends an edit only when something changed, and voids once", async () => {
    const { createMemoryPurchaseLedger } = await import("./purchase-ledger");
    const ledger = createMemoryPurchaseLedger();
    const base = { purchaseId: "p1", inventoryItemId: "i1", purchasedAt: "2026-10-01", snapshot: { price: 5 }, at: "t1" };
    ledger.record("u", base);
    ledger.record("u", base);
    ledger.record("u", { ...base, snapshot: { price: 6 }, at: "t2" });
    expect(ledger.list("u").map((e) => e.kind)).toEqual(["recorded", "edited"]);
    expect(ledger.voidForItem("u", "i1", "t3")).toBe(1);
    expect(ledger.voidForItem("u", "i1", "t4")).toBe(0);
    ledger.record("u", { ...base, snapshot: { price: 7 } });
    expect(ledger.list("u").map((e) => e.kind)).toEqual(["recorded", "edited", "voided"]);
    expect(ledger.activePurchaseTimes("u")).toEqual([]);
  });
});

describe.each(stores)("purchase ledger (%s)", (_name, makeStore) => {
  it("undo voids the purchase (row kept) and North Star excludes it", async () => {
    const store = makeStore();
    const app = createApp(store, { opsToken: "t" });
    await purchase(app, true);
    const undone = await purchase(app, false);
    const users = store.listInvitedUsers().map((u) => u.userId);
    const owner = users.find((id) => store.purchaseLedger.list(id).length > 0)!;
    expect(store.purchaseLedger.activePurchaseTimes(owner)).toHaveLength(2);
    expect((await app.request(`/v1/inventory/${undone}`, { method: "DELETE" })).status).toBe(200);
    const rows = store.purchaseLedger.list(owner);
    expect(new Set(rows.map((row) => row.purchaseId)).size).toBe(2);
    expect(rows.filter((row) => row.kind === "voided")).toHaveLength(1);
    // Append-only: the recorded rows are still there, with their snapshots.
    expect(rows.filter((row) => row.kind === "recorded")).toHaveLength(2);
    expect(rows.find((row) => row.kind === "recorded")?.snapshot).toContain("costBasis");
    expect(store.purchaseLedger.activePurchaseTimes(owner)).toHaveLength(1);
    const body = (await (await app.request("/ops/north-star?weeks=1", { headers: { authorization: "Bearer t" } })).json()) as {
      weeks: Array<{ purchased: number }>;
    };
    expect(body.weeks.at(-1)?.purchased).toBe(1);
  });

  it("account deletion anonymizes the ledger, so North Star past weeks don't shift", async () => {
    const store = makeStore();
    const app = createApp(store, { opsToken: "t" });
    await purchase(app, true);
    const owner = store.listInvitedUsers().map((u) => u.userId).find((id) => store.purchaseLedger.list(id).length > 0)!;
    const northStar = async () =>
      ((await (await app.request("/ops/north-star?weeks=1", { headers: { authorization: "Bearer t" } })).json()) as {
        weeks: Array<{ purchased: number }>;
      }).weeks.at(-1)?.purchased;
    expect(await northStar()).toBe(1);
    expect((await app.request("/v1/account/delete", { method: "POST" })).status).toBe(200);
    expect(store.purchaseLedger.list(owner)).toHaveLength(0);
    const anon = store.purchaseLedger.listUserIds().filter((id) => id.startsWith("deleted_"));
    expect(anon).toHaveLength(1);
    expect(store.purchaseLedger.list(anon[0]!).every((row) => row.snapshot === null)).toBe(true);
    expect(await northStar()).toBe(1);
  });
;
});
