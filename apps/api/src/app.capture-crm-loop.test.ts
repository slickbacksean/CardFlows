import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  composeMessyCiCardStill,
  createObbPhashRecognitionProvider,
  LOCKED_DISPLAY_CURRENCY,
  mockCardRecognitionProvider,
} from "@cardflow/shared";
import { createApp } from "./app";
import { decodeScanStill, encodePngStill } from "./obb-phash-decode";
import { createRecognitionFromEnv } from "./recognition-env";
import { createSqliteStore, type SqliteStorePort } from "./sqlite-store";
import { createStoreFromEnv } from "./store-env";

type App = ReturnType<typeof createApp>;

const PRIVATE_NOTES = "Private: all-in was $11.75. Maybe list on eBay later.";

async function json<T>(
  app: App,
  pathName: string,
  init: RequestInit = {},
): Promise<{ status: number; body: T }> {
  const response = await app.request(pathName, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  return { status: response.status, body: (await response.json()) as T };
}

async function completePurchasedDraftCopy(
  app: App,
  scanId: string,
  tcgdexId: string,
) {
  const inventoryAfterScan = await json<{ items: unknown[] }>(app, "/v1/inventory");
  expect(inventoryAfterScan.body.items).toHaveLength(0);

  const confirmed = await json<{
    scan: { cardflowCardId: string; inventoryItemId: string | null };
    confirmation: { confirmationId: string; mintedCardflowCardId: boolean };
    canonicalCard: { tcgdexId: string; cardsightCardId: string | null; cardflowCardId: string };
  }>(app, `/v1/scans/${scanId}/confirm`, {
    method: "POST",
    body: JSON.stringify({ tcgdexId }),
  });
  expect(confirmed.status).toBe(200);
  expect(confirmed.body.scan.inventoryItemId).toBeNull();
  expect(confirmed.body.confirmation.mintedCardflowCardId).toBe(true);
  expect(confirmed.body.canonicalCard.tcgdexId).toBe(tcgdexId);
  expect(confirmed.body.canonicalCard.cardflowCardId).not.toBe(tcgdexId);

  const inventoryAfterConfirm = await json<{ items: unknown[] }>(app, "/v1/inventory");
  expect(inventoryAfterConfirm.body.items).toHaveLength(0);

  const maxBuy = await json<{
    maxBuy: { maxBuyAmount: string | null; currency: string };
  }>(app, "/v1/max-buy", {
    method: "POST",
    body: JSON.stringify({ referencePriceAmount: "8.00", condition: "NM" }),
  });
  expect(maxBuy.status).toBe(200);
  expect(maxBuy.body.maxBuy.maxBuyAmount).toBeTruthy();
  expect(maxBuy.body.maxBuy.currency).toBe(LOCKED_DISPLAY_CURRENCY);

  const purchased = await json<{
    item: {
      inventoryItemId: string;
      intent: string;
      purchase: { currency: string; costBasis: { allInTotal: string } };
    };
  }>(app, "/v1/inventory/purchased", {
    method: "POST",
    body: JSON.stringify({
      confirmationId: confirmed.body.confirmation.confirmationId,
      purchasePrice: "10.50",
      purchasedAt: "2026-09-16",
      shipping: "1.25",
      currency: "EUR",
      referencePriceAmount: "8.00",
      condition: "NM",
    }),
  });
  expect(purchased.status).toBe(201);
  expect(purchased.body.item.intent).toBe("purchased");
  expect(purchased.body.item.purchase.currency).toBe(LOCKED_DISPLAY_CURRENCY);
  expect(purchased.body.item.purchase.costBasis.allInTotal).toBe("11.75");

  const draft = await json<{ draft: { draftId: string; currency: string } }>(
    app,
    `/v1/inventory/${purchased.body.item.inventoryItemId}/drafts`,
    { method: "POST" },
  );
  expect(draft.status).toBe(201);
  expect(draft.body.draft.currency).toBe(LOCKED_DISPLAY_CURRENCY);

  await json(app, `/v1/drafts/${draft.body.draft.draftId}`, {
    method: "PATCH",
    body: JSON.stringify({
      askingPrice: "15.00",
      notes: PRIVATE_NOTES,
      intendedChannelNote: "Maybe list on eBay later",
    }),
  });

  const copy = await json<{
    clipboard: {
      omittedPrivateNotes: boolean;
      omittedChannelNote: boolean;
      published: boolean;
      plainText: string;
    };
  }>(app, `/v1/drafts/${draft.body.draft.draftId}/clipboard`);
  expect(copy.status).toBe(200);
  expect(copy.body.clipboard.omittedPrivateNotes).toBe(true);
  expect(copy.body.clipboard.omittedChannelNote).toBe(true);
  expect(copy.body.clipboard.published).toBe(false);
  expect(copy.body.clipboard.plainText).toContain(LOCKED_DISPLAY_CURRENCY);
  expect(copy.body.clipboard.plainText).toContain("15.00");
  expect(copy.body.clipboard.plainText).not.toContain("Private");
  expect(copy.body.clipboard.plainText).not.toContain("eBay");
  expect(copy.body.clipboard.plainText).not.toContain("EUR");

  return {
    inventoryItemId: purchased.body.item.inventoryItemId,
    draftId: draft.body.draft.draftId,
    tcgdexId,
  };
}

describe("Task 5 Capture CRM loop", () => {
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

  function openFileApp(options: Parameters<typeof createApp>[1] = {}) {
    const dir = mkdtempSync(path.join(tmpdir(), "cardflow-capture-loop-"));
    tempDirs.push(dir);
    const sqlitePath = path.join(dir, "cardflow.sqlite");
    const store = createSqliteStore({ sqlitePath });
    stores.push(store);
    return { sqlitePath, store, app: createApp(store, options) };
  }

  function reopen(sqlitePath: string, options: Parameters<typeof createApp>[1] = {}) {
    stores.pop()?.close();
    const store = createSqliteStore({ sqlitePath });
    stores.push(store);
    return { store, app: createApp(store, options) };
  }

  it("keeps CI on mock recognition even if the OBB flag is set", () => {
    expect(process.env.CARD_FLOW_STORE).toBe("memory");
    expect(createStoreFromEnv().selection.kind).toBe("memory");
    expect(createRecognitionFromEnv().recognition.name).toBe("mock");
    expect(createRecognitionFromEnv().selection.kind).toBe("mock");
    expect(
      createRecognitionFromEnv({
        VITEST: "true",
        CARD_FLOW_OBB_PHASH_ENABLED: "true",
      }).selection,
    ).toMatchObject({ kind: "mock", identifyEnabled: false });
    expect(mockCardRecognitionProvider.name).toBe("mock");
  });

  it("completes mock still → Confirm → Max Buy → Purchased → draft → Copy in CI", async () => {
    const app = createApp();
    const scan = await json<{
      scan: {
        scanId: string;
        cardflowCardId: string | null;
        inventoryItemId: string | null;
        recognition: { provider: string };
      };
    }>(app, "/v1/scans", {
      method: "POST",
      body: JSON.stringify({ captureMethod: "camera_photo", scenario: "high-confidence" }),
    });
    expect(scan.status).toBe(201);
    expect(scan.body.scan.cardflowCardId).toBeNull();
    expect(scan.body.scan.inventoryItemId).toBeNull();
    expect(scan.body.scan.recognition.provider).toBe("mock");

    await completePurchasedDraftCopy(app, scan.body.scan.scanId, "base1-58");
  });

  // CPU-bound pHash over a full still; the default 5 s timeout is too tight on slow runners.
  it("completes OBB + pHash still loop, survives API reopen, Copy omits notes, USD only", { timeout: 30_000 }, async () => {
    const messy = composeMessyCiCardStill("base1-58");
    const png = encodePngStill(messy.bitmap);
    const recognition = createObbPhashRecognitionProvider({
      decode: decodeScanStill,
      detector: { async detect() { return [messy.box]; } },
    });
    const ports = { recognition, liveIdentifyEnabled: true };
    const { sqlitePath, app: firstApp } = openFileApp(ports);

    const form = new FormData();
    form.append("captureMethod", "camera_photo");
    form.append("scenario", "high-confidence");
    form.append("image", new File([png], "messy-still.png", { type: "image/png" }));
    const scanResponse = await firstApp.request("/v1/scans", { method: "POST", body: form });
    expect(scanResponse.status).toBe(201);
    const scanBody = (await scanResponse.json()) as {
      scan: {
        scanId: string;
        cardflowCardId: string | null;
        inventoryItemId: string | null;
        recognition: { provider: string; detections: Array<{ vendorCardId: string | null }> };
        mapping: {
          tcgdexId: string | null;
          cardsightCardId: string | null;
          userConfirmation: { required: boolean; crmWriteAllowedBeforeConfirm: boolean };
        };
      };
    };
    expect(scanBody.scan.cardflowCardId).toBeNull();
    expect(scanBody.scan.inventoryItemId).toBeNull();
    expect(scanBody.scan.recognition.provider).toBe("obb_phash");
    expect(scanBody.scan.recognition.detections[0]?.vendorCardId).toBe("base1-58");
    expect(scanBody.scan.mapping.tcgdexId).toBe("base1-58");
    expect(scanBody.scan.mapping.cardsightCardId).toBeNull();
    expect(scanBody.scan.mapping.userConfirmation.required).toBe(true);
    expect(scanBody.scan.mapping.userConfirmation.crmWriteAllowedBeforeConfirm).toBe(false);

    const saved = await completePurchasedDraftCopy(
      firstApp,
      scanBody.scan.scanId,
      "base1-58",
    );

    const db = new Database(sqlitePath);
    const column = db
      .prepare("select cardsight_card_id as cardsightCardId from crm_scans where scan_id = ?")
      .get(scanBody.scan.scanId) as { cardsightCardId: string | null };
    db.close();
    expect(column.cardsightCardId).toBeNull();

    const { app } = reopen(sqlitePath, ports);

    const inventory = await json<{
      items: Array<{
        inventoryItemId: string;
        intent: string;
        draft: { draftId: string } | null;
        card: { tcgdexId: string } | null;
        purchase: { currency: string } | null;
      }>;
    }>(app, "/v1/inventory");
    expect(inventory.body.items).toHaveLength(1);
    expect(inventory.body.items[0]?.intent).toBe("purchased");
    expect(inventory.body.items[0]?.inventoryItemId).toBe(saved.inventoryItemId);
    expect(inventory.body.items[0]?.draft?.draftId).toBe(saved.draftId);
    expect(inventory.body.items[0]?.card?.tcgdexId).toBe("base1-58");
    expect(inventory.body.items[0]?.purchase?.currency).toBe(LOCKED_DISPLAY_CURRENCY);

    const savedDraft = await json<{ draft: { notes: string; currency: string } }>(
      app,
      `/v1/drafts/${saved.draftId}`,
    );
    expect(savedDraft.body.draft.notes).toBe(PRIVATE_NOTES);
    expect(savedDraft.body.draft.currency).toBe(LOCKED_DISPLAY_CURRENCY);

    const copyAfter = await json<{
      clipboard: { omittedPrivateNotes: boolean; published: boolean; plainText: string };
    }>(app, `/v1/drafts/${saved.draftId}/clipboard`);
    expect(copyAfter.status).toBe(200);
    expect(copyAfter.body.clipboard.omittedPrivateNotes).toBe(true);
    expect(copyAfter.body.clipboard.published).toBe(false);
    expect(copyAfter.body.clipboard.plainText).toContain(LOCKED_DISPLAY_CURRENCY);
    expect(copyAfter.body.clipboard.plainText).toContain("15.00");
    expect(copyAfter.body.clipboard.plainText).not.toContain("Private");
    expect(copyAfter.body.clipboard.plainText).not.toContain("eBay");
    expect(copyAfter.body.clipboard.plainText).not.toContain(PRIVATE_NOTES);
    expect(JSON.stringify(copyAfter.body)).not.toMatch(/cardsight\.ai|X-API-Key/i);
  });
});
