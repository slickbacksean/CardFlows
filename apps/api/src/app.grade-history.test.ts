import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_INVITED_USER_ID, INVITED_USERS, mapRecognitionToCatalog } from "@cardflow/shared";
import { identifyCardMock } from "@cardflow/shared/mock";
import { createApp } from "./app";
import { recordGradeEstimate } from "./routes/grade-history";
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

describe("P2-07 grade estimate history", () => {
  const stores: SqliteStorePort[] = [];
  const dirs: string[] = [];
  afterEach(() => {
    for (const store of stores.splice(0)) store.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  function open() {
    const dir = mkdtempSync(path.join(tmpdir(), "cardflow-gh-"));
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

  it("records real estimates, skips empty ones and repeats, imports once, lists newest 8", async () => {
    const store = open();
    const app = createApp(store, { premiumUserIds: [DEFAULT_INVITED_USER_ID] });
    const item = await purchasedItem(store, DEFAULT_INVITED_USER_ID);
    const u = DEFAULT_INVITED_USER_ID;
    expect(recordGradeEstimate(store.gradeHistory, u, item.inventoryItemId, { overall: null, confidence: null }, "2026-10-01T00:00:00Z")).toBe(false);
    expect(recordGradeEstimate(store.gradeHistory, u, item.inventoryItemId, { overall: 8, confidence: "medium" }, "2026-10-01T00:00:00.000Z")).toBe(true);
    expect(recordGradeEstimate(store.gradeHistory, u, item.inventoryItemId, { overall: 8, confidence: "medium" }, "2026-10-01T00:00:20.000Z")).toBe(false);
    const entries = [{ at: "2026-09-01T00:00:00Z", overall: 7 }, { at: "2026-09-01T00:00:00Z", overall: 7 }, { at: "bad", overall: 7 }, { at: "2026-09-02T00:00:00Z", overall: 0 }];
    const imported = (await (await app.request(`/v1/inventory/${item.inventoryItemId}/grade-history`, post({ entries }))).json()) as { imported: number };
    expect(imported.imported).toBe(1);
    const again = (await (await app.request(`/v1/inventory/${item.inventoryItemId}/grade-history`, post({ entries }))).json()) as { imported: number };
    expect(again.imported).toBe(0);
    for (let i = 0; i < 10; i += 1) recordGradeEstimate(store.gradeHistory, u, item.inventoryItemId, { overall: 5 + i / 10, confidence: null }, new Date(Date.UTC(2026, 9, 2 + i)).toISOString());
    const listed = (await (await app.request(`/v1/inventory/${item.inventoryItemId}/grade-history`)).json()) as { history: Array<{ overall: number }> };
    expect(listed.history).toHaveLength(8);
    expect(listed.history.at(-1)?.overall).toBe(5.9);
  });

  it("is per user and account deletion removes only the caller's history", async () => {
    const store = open();
    const app = createApp(store);
    const other = INVITED_USERS.find((user) => user.userId !== DEFAULT_INVITED_USER_ID)!.userId;
    const theirs = await purchasedItem(store, other);
    recordGradeEstimate(store.gradeHistory, other, theirs.inventoryItemId, { overall: 9, confidence: null }, "2026-10-01T00:00:00Z");
    expect((await app.request(`/v1/inventory/${theirs.inventoryItemId}/grade-history`)).status).toBe(404);
    const mine = await purchasedItem(store, DEFAULT_INVITED_USER_ID);
    recordGradeEstimate(store.gradeHistory, DEFAULT_INVITED_USER_ID, mine.inventoryItemId, { overall: 6, confidence: null }, "2026-10-01T00:00:00Z");
    const res = (await (await app.request("/v1/account/delete", { method: "POST" })).json()) as { gradeHistoryDeleted: number };
    expect(res.gradeHistoryDeleted).toBe(1);
    expect(store.gradeHistory.list(DEFAULT_INVITED_USER_ID, mine.inventoryItemId)).toEqual([]);
    expect(store.gradeHistory.list(other, theirs.inventoryItemId)).toHaveLength(1);
  });

  it("D14: free users' history keeps saving but the list is premium-only", async () => {
    const store = open();
    const free = createApp(store, { premiumUserIds: [] });
    const item = await purchasedItem(store, DEFAULT_INVITED_USER_ID);
    expect(recordGradeEstimate(store.gradeHistory, DEFAULT_INVITED_USER_ID, item.inventoryItemId, { overall: 7, confidence: null }, "2026-10-01T00:00:00Z")).toBe(true);
    const locked = await free.request(`/v1/inventory/${item.inventoryItemId}/grade-history`);
    expect(locked.status).toBe(403);
    expect(await locked.json()).toMatchObject({ code: "premium_required", feature: "grade_history" });
    const imported = (await (await free.request(`/v1/inventory/${item.inventoryItemId}/grade-history`, post({ entries: [{ at: "2026-09-01T00:00:00Z", overall: 6 }] }))).json()) as { imported: number; history: unknown[] };
    expect(imported).toMatchObject({ imported: 1, history: [] });
    expect(store.gradeHistory.list(DEFAULT_INVITED_USER_ID, item.inventoryItemId)).toHaveLength(2);
    // Upgrading reveals everything saved while free.
    const premium = createApp(store, { premiumUserIds: [DEFAULT_INVITED_USER_ID] });
    const listed = (await (await premium.request(`/v1/inventory/${item.inventoryItemId}/grade-history`)).json()) as { history: unknown[] };
    expect(listed.history).toHaveLength(2);
  });

  it("D14: batch grading is premium-only", async () => {
    const store = open();
    const free = await createApp(store, { premiumUserIds: [] }).request("/v1/grading/batch", { method: "POST" });
    expect(free.status).toBe(403);
    expect(await free.json()).toMatchObject({ code: "premium_required", feature: "batch_grading" });
    const premium = await createApp(store, { premiumUserIds: [DEFAULT_INVITED_USER_ID] }).request("/v1/grading/batch", { method: "POST" });
    expect(premium.status).toBe(200);
  });
});
