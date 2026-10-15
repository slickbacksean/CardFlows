import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_INVITED_USER_ID, INVITED_USERS, mapRecognitionToCatalog } from "@cardflow/shared";
import { identifyCardMock } from "@cardflow/shared/mock";
import { createApp } from "./app";
import { createSqliteStore, type SqliteStorePort } from "./sqlite-store";
import type { ScanRecord } from "./store";

async function makeScan(userId: string): Promise<ScanRecord> {
  const recognition = identifyCardMock("high-confidence");
  return {
    scanId: crypto.randomUUID(),
    userId,
    capturedAt: new Date().toISOString(),
    captureMethod: "camera_photo",
    scenario: "high-confidence",
    preInventoryState: "scan_captured",
    cardflowCardId: null,
    confirmationId: null,
    inventoryItemId: null,
    imageStorageRef: null,
    imageMimeType: null,
    recognition,
    mapping: await mapRecognitionToCatalog(recognition),
  };
}

async function purchasedItem(store: SqliteStorePort, userId: string) {
  const { confirmation, canonicalCard } = store.confirmScan({
    scan: store.saveScan(await makeScan(userId)),
    selectedTcgdexId: "base1-58",
  });
  return store.saveInventoryItem({
    inventoryItemId: crypto.randomUUID(),
    userId,
    cardflowCardId: canonicalCard.cardflowCardId as string,
    confirmationId: confirmation.confirmationId,
    scanId: confirmation.scanId,
    intent: "purchased",
    grain: "physical_copy",
    selectedVariant: null,
    condition: null,
    quantity: 1,
    tags: ["raw"],
    workflowState: "acquired",
    referencePriceAmount: null,
    targetMaxBuyAmount: null,
    createdAt: new Date().toISOString(),
    purchase: null,
  });
}

describe("P2-03 sale records", () => {
  const stores: SqliteStorePort[] = [];
  const dirs: string[] = [];
  afterEach(() => {
    for (const store of stores.splice(0)) store.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  function open() {
    const dir = mkdtempSync(path.join(tmpdir(), "cardflow-sales-"));
    dirs.push(dir);
    const store = createSqliteStore({ sqlitePath: path.join(dir, "db.sqlite") });
    stores.push(store);
    return store;
  }
  const post = (body: unknown) => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  it("saves, lists, honors onlyIfMissing, deletes, and survives a reopen", async () => {
    const store = open();
    const app = createApp(store);
    const item = await purchasedItem(store, DEFAULT_INVITED_USER_ID);
    const first = await app.request(`/v1/sales/${item.inventoryItemId}`, post({ price: "25", fees: "3.25", soldAt: "2026-10-10T00:00:00Z" }));
    expect(first.status).toBe(200);
    expect(((await first.json()) as { created: boolean }).created).toBe(true);
    const kept = await app.request(`/v1/sales/${item.inventoryItemId}`, post({ price: "1", onlyIfMissing: true }));
    expect(((await kept.json()) as { sale: { price: string } }).sale.price).toBe("25.00");
    const listed = (await (await app.request("/v1/sales")).json()) as { sales: Array<{ price: string; fees: string | null; soldAt: string }> };
    expect(listed.sales).toEqual([expect.objectContaining({ price: "25.00", fees: "3.25", soldAt: "2026-10-10T00:00:00.000Z" })]);
    expect((await app.request(`/v1/sales/${item.inventoryItemId}`, post({ price: "abc" }))).status).toBe(400);
    const deleted = await app.request(`/v1/sales/${item.inventoryItemId}`, { method: "DELETE" });
    expect(((await deleted.json()) as { deleted: boolean }).deleted).toBe(true);
    expect(store.sales.list(DEFAULT_INVITED_USER_ID)).toEqual([]);
  });

  it("is per user and account deletion removes the caller's sales only", async () => {
    const store = open();
    const app = createApp(store);
    const other = INVITED_USERS.find((user) => user.userId !== DEFAULT_INVITED_USER_ID)!.userId;
    const theirs = await purchasedItem(store, other);
    expect((await app.request(`/v1/sales/${theirs.inventoryItemId}`, post({ price: "5" }))).status).toBe(404);
    store.sales.save(other, { inventoryItemId: theirs.inventoryItemId, priceCents: 500, feesCents: null, soldAt: "x", updatedAt: "x" });
    const mine = await purchasedItem(store, DEFAULT_INVITED_USER_ID);
    await app.request(`/v1/sales/${mine.inventoryItemId}`, post({ price: "9" }));
    expect(((await (await app.request("/v1/sales")).json()) as { sales: unknown[] }).sales).toHaveLength(1);
    const res = await app.request("/v1/account/delete", { method: "POST" });
    expect(((await res.json()) as { salesDeleted: number }).salesDeleted).toBe(1);
    expect(store.sales.list(DEFAULT_INVITED_USER_ID)).toEqual([]);
    expect(store.sales.list(other)).toHaveLength(1);
  });
});
