import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  computeAllInCost,
  computeMaxBuy,
  DEFAULT_INVITED_USER_ID,
  DEFAULT_MAX_BUY_PREFERENCES,
  INVITED_USERS,
  mapRecognitionToCatalog,
} from "@cardflow/shared";
import { identifyCardMock } from "@cardflow/shared/mock";
import { createApp } from "./app";
import { hashSessionToken } from "./session";
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

describe("SQLite store adapter", () => {
  const tempDirs: string[] = [];
  const stores: SqliteStorePort[] = [];

  afterEach(() => {
    for (const store of stores.splice(0)) {
      store.close();
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function fileStore() {
    const dir = mkdtempSync(path.join(tmpdir(), "cardflow-sqlite-"));
    tempDirs.push(dir);
    const store = createSqliteStore({ sqlitePath: path.join(dir, "cardflow.sqlite") });
    stores.push(store);
    return { dir, store, sqlitePath: path.join(dir, "cardflow.sqlite") };
  }

  function memoryStore() {
    const store = createSqliteStore({ sqlitePath: ":memory:" });
    stores.push(store);
    return store;
  }

  it("applies migrations and serves /health from a gitignored file path", async () => {
    const { store, sqlitePath } = fileStore();
    const app = createApp(store);
    const response = await app.request("/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      service: "cardflow-api",
      recognition: "mock",
      pricingProvider: "off",
    });
    expect(sqlitePath).toMatch(/cardflow\.sqlite$/);
  });

  it("uses :memory: without creating a disk file", async () => {
    const store = memoryStore();
    const app = createApp(store);
    const response = await app.request("/health");
    expect(response.status).toBe(200);
    expect(store.sqlitePath).toBe(":memory:");
  });

  it("persists Max Buy prefs and scans across reopen", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cardflow-sqlite-"));
    tempDirs.push(dir);
    const sqlitePath = path.join(dir, "cardflow.sqlite");
    const first = createSqliteStore({ sqlitePath });
    const nextPrefs = {
      ...DEFAULT_MAX_BUY_PREFERENCES,
      targetMarginPct: 0.3,
    };
    first.setPreferences(DEFAULT_INVITED_USER_ID, nextPrefs);
    const scan = first.saveScan(await makeScan(DEFAULT_INVITED_USER_ID));
    first.close();

    const second = createSqliteStore({ sqlitePath });
    stores.push(second);
    expect(second.getPreferences(DEFAULT_INVITED_USER_ID).targetMarginPct).toBe(0.3);
    expect(second.getScan(DEFAULT_INVITED_USER_ID, scan.scanId)?.scanId).toBe(scan.scanId);
    expect(second.listInventory(DEFAULT_INVITED_USER_ID)).toEqual([]);
    expect(second.getScan(DEFAULT_INVITED_USER_ID, scan.scanId)?.imageStorageRef).toBeNull();
  });

  it("rewrites a stored condition map that is not finite numbers >= 0", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cardflow-sqlite-"));
    tempDirs.push(dir);
    const sqlitePath = path.join(dir, "cardflow.sqlite");
    const store = createSqliteStore({ sqlitePath });
    stores.push(store);
    store.setPreferences(DEFAULT_INVITED_USER_ID, {
      ...DEFAULT_MAX_BUY_PREFERENCES,
      conditionAdjustments: { NM: 1, LP: 0.85 },
    });
    const raw = new Database(sqlitePath);
    raw
      .prepare(
        "update user_preferences set max_buy_condition_adjustments_json = ? where user_id = ?",
      )
      .run('{"NM":-5,"LP":"x"}', DEFAULT_INVITED_USER_ID);
    raw.close();

    expect(store.getPreferences(DEFAULT_INVITED_USER_ID).conditionAdjustments).toBeNull();

    const reread = new Database(sqlitePath, { readonly: true });
    const stored = reread
      .prepare(
        "select max_buy_condition_adjustments_json as json from user_preferences where user_id = ?",
      )
      .get(DEFAULT_INVITED_USER_ID) as { json: string | null };
    reread.close();
    expect(stored.json).toBeNull();
  });

  it("persists first-party scan bytes next to the SQLite file", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cardflow-sqlite-"));
    tempDirs.push(dir);
    const sqlitePath = path.join(dir, "cardflow.sqlite");
    const first = createSqliteStore({ sqlitePath });
    const userId = DEFAULT_INVITED_USER_ID;
    const scanId = crypto.randomUUID();
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const savedImage = first.saveScanImage(scanId, { bytes, mimeType: "image/jpeg" });
    expect(first.readStoredScanImage(scanId, savedImage.storageRef)?.bytes).toEqual(bytes);
    first.saveScan({
      ...(await makeScan(userId)),
      scanId,
      imageStorageRef: savedImage.storageRef,
      imageMimeType: savedImage.mimeType,
    });
    first.close();

    const second = createSqliteStore({ sqlitePath });
    stores.push(second);
    expect(second.getScan(userId, scanId)?.imageStorageRef).toBe(`scans/${scanId}.jpg`);
    expect(second.getScanImage(userId, scanId)?.mimeType).toBe("image/jpeg");
    expect(second.getScanImage(userId, scanId)?.bytes).toEqual(bytes);
    expect(second.readStoredScanImage(scanId, `scans/${scanId}.jpg`)?.bytes).toEqual(bytes);
    expect(path.join(dir, savedImage.storageRef)).toBe(path.join(dir, "scans", `${scanId}.jpg`));
  });

  it("persists first-party grade stills next to the SQLite file", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cardflow-sqlite-"));
    tempDirs.push(dir);
    const sqlitePath = path.join(dir, "cardflow.sqlite");
    const first = createSqliteStore({ sqlitePath });
    const userId = DEFAULT_INVITED_USER_ID;
    const { confirmation, canonicalCard } = first.confirmScan({
      scan: first.saveScan(await makeScan(userId)),
      selectedTcgdexId: "base1-58",
    });
    const item = first.saveInventoryItem({
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
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const saved = first.saveGradeImage(userId, item.inventoryItemId, "back", {
      bytes,
      mimeType: "image/jpeg",
    });
    expect(saved?.storageRef).toBe(`grade/${item.inventoryItemId}-back.jpg`);
    expect(first.getGradeImage(userId, item.inventoryItemId, "back")?.bytes).toEqual(bytes);
    first.close();

    const second = createSqliteStore({ sqlitePath });
    stores.push(second);
    expect(second.getGradeImage(userId, item.inventoryItemId, "back")?.mimeType).toBe("image/jpeg");
    expect(second.getGradeImage(userId, item.inventoryItemId, "back")?.bytes).toEqual(bytes);
    expect(path.join(dir, saved!.storageRef)).toBe(
      path.join(dir, "grade", `${item.inventoryItemId}-back.jpg`),
    );
  });

  it("mints cardflow_card_id on Confirm and reuses it for the same catalog id", async () => {
    const store = memoryStore();
    const userId = DEFAULT_INVITED_USER_ID;
    const first = store.confirmScan({
      scan: store.saveScan(await makeScan(userId)),
      selectedTcgdexId: "base1-58",
    });
    expect(first.confirmation.mintedCardflowCardId).toBe(true);
    expect(first.scan.cardflowCardId).toBe(first.canonicalCard.cardflowCardId);
    expect(store.listInventory(userId)).toEqual([]);

    const second = store.confirmScan({
      scan: store.saveScan(await makeScan(userId)),
      selectedTcgdexId: "base1-58",
    });
    expect(second.confirmation.mintedCardflowCardId).toBe(false);
    expect(second.canonicalCard.cardflowCardId).toBe(first.canonicalCard.cardflowCardId);
  });

  it("refreshes catalog cache fields without changing cardflow_card_id", async () => {
    const store = memoryStore();
    const userId = DEFAULT_INVITED_USER_ID;
    const first = store.confirmScan({
      scan: store.saveScan(await makeScan(userId)),
      selectedTcgdexId: "base1-58",
    });
    const second = store.confirmScan({
      scan: store.saveScan(await makeScan(userId)),
      selectedTcgdexId: "base1-58",
      catalogCard: {
        ...first.canonicalCard,
        name: "Pikachu refreshed",
        set: { ...first.canonicalCard.set, name: "Base Set (cached)" },
        variants: { ...first.canonicalCard.variants, reverse: true },
      },
    });
    expect(second.confirmation.mintedCardflowCardId).toBe(false);
    expect(second.canonicalCard.cardflowCardId).toBe(first.canonicalCard.cardflowCardId);
    const cached = store.getCanonical(first.canonicalCard.cardflowCardId as string);
    expect(cached?.name).toBe("Pikachu refreshed");
    expect(cached?.set.name).toBe("Base Set (cached)");
    expect(cached?.localId).toBe("58");
    expect(cached?.variants.reverse).toBe(true);
    expect(cached?.image.source).toBe("tcgdex_assets");
    expect(cached?.image.constructedUrl).toContain("assets.tcgdex.net");
    expect(cached?.image.constructedUrl).not.toContain("/v1/scans/");
  });

  it("filters CRM rows by the active invited user", async () => {
    const store = memoryStore();
    const alex = INVITED_USERS[0].userId;
    const jordan = INVITED_USERS[1].userId;
    const scan = store.saveScan(await makeScan(alex));
    expect(store.getScan(jordan, scan.scanId)).toBeUndefined();
    expect(store.listScans(jordan)).toEqual([]);
    expect(store.getScan(alex, scan.scanId)?.scanId).toBe(scan.scanId);
  });

  it("persists purchased money as cents and returns dollar strings", async () => {
    const store = memoryStore();
    const userId = DEFAULT_INVITED_USER_ID;
    const { confirmation, canonicalCard } = store.confirmScan({
      scan: store.saveScan(await makeScan(userId)),
      selectedTcgdexId: "base1-58",
    });
    const costBasis = computeAllInCost({ purchasePrice: "10.50", shipping: "1.25" });
    const maxBuy = computeMaxBuy({
      referencePriceAmount: "20",
      preferences: store.getPreferences(userId),
    });
    const item = store.saveInventoryItem({
      inventoryItemId: crypto.randomUUID(),
      userId,
      cardflowCardId: canonicalCard.cardflowCardId as string,
      confirmationId: confirmation.confirmationId,
      scanId: confirmation.scanId,
      intent: "purchased",
      grain: "physical_copy",
      selectedVariant: null,
      condition: "NM",
      quantity: 1,
      tags: ["raw"],
      workflowState: "acquired",
      referencePriceAmount: maxBuy.referencePriceAmount,
      targetMaxBuyAmount: null,
      createdAt: new Date().toISOString(),
      purchase: {
        purchaseId: crypto.randomUUID(),
        purchasedAt: "2026-09-16",
        currency: "USD",
        costBasis,
        maxBuy,
      },
    });
    const loaded = store.getInventoryItem(userId, item.inventoryItemId);
    expect(loaded?.purchase?.costBasis.allInTotal).toBe("11.75");
    expect(loaded?.referencePriceAmount).toBe("20.00");
    expect(store.getCanonical(item.cardflowCardId)?.tcgdexId).toBe("base1-58");
  });

  it("persists hashed session tokens across reopen and never stores the raw token", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cardflow-sqlite-"));
    tempDirs.push(dir);
    const sqlitePath = path.join(dir, "cardflow.sqlite");
    const first = createSqliteStore({ sqlitePath });
    const created = first.createSession(INVITED_USERS[0].userId);
    first.close();

    const sqlite = new Database(sqlitePath);
    const row = sqlite
      .prepare(`SELECT token_hash, user_id FROM crm_sessions`)
      .get() as { token_hash: string; user_id: string };
    sqlite.close();
    expect(row.user_id).toBe(INVITED_USERS[0].userId);
    expect(row.token_hash).toBe(hashSessionToken(created.token));
    expect(row.token_hash).not.toBe(created.token);

    const second = createSqliteStore({ sqlitePath });
    stores.push(second);
    expect(second.getSessionByToken(created.token)?.userId).toBe(INVITED_USERS[0].userId);
  });
});
