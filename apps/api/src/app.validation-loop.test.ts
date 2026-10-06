import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMockPricingProvider,
  healthLeaksSecrets,
  LOCKED_DISPLAY_CURRENCY,
  mockCardRecognitionProvider,
  mockTcgdexCatalogProvider,
  PRICE_ESTIMATE_REFERENCE_SOURCE,
} from "@cardflow/shared";
import { createApp } from "./app";
import { createCatalogFromEnv } from "./catalog-env";
import { createPricingFromEnv } from "./pokecollector-env";
import { createRecognitionFromEnv } from "./recognition-env";
import { createGradeEstimateFromEnv } from "./grade-estimate-env";
import { createMemoryStore } from "./store";
import { createStoreFromEnv } from "./store-env";
import { createSqliteStore, type SqliteStorePort } from "./sqlite-store";

type App = ReturnType<typeof createApp>;

const CARDSIGHT_VENDOR_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
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

function mockPortsApp(store = createMemoryStore()) {
  return createApp(store, {
    catalog: mockTcgdexCatalogProvider,
    pricing: createMockPricingProvider(),
    recognition: mockCardRecognitionProvider,
  });
}

describe("Task 28 full loop with or without live HTTP", () => {
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

  it("keeps pnpm test on mocks without vendor keys or PokéCollector", () => {
    expect(process.env.CARD_FLOW_STORE).toBe("memory");
    expect(createStoreFromEnv().selection.kind).toBe("memory");
    expect(process.env.CARDSIGHT_API_KEY ?? "").toBe("");
    expect(process.env.CARD_FLOW_POKECOLLECTOR_TOKEN ?? "").toBe("");
    expect(process.env.CARD_FLOW_POKECOLLECTOR_URL ?? "").toBe("");

    expect(createCatalogFromEnv().catalog.name).toBe("mock");
    expect(createCatalogFromEnv().selection.kind).toBe("mock");
    expect(createPricingFromEnv().pricing.name).toBe("off");
    expect(createPricingFromEnv().selection.enabled).toBe(false);
    expect(createRecognitionFromEnv().recognition.name).toBe("mock");
    expect(createRecognitionFromEnv().selection.kind).toBe("mock");
    expect(createGradeEstimateFromEnv().grading.name).toBe("mock");
    expect(createGradeEstimateFromEnv().selection.kind).toBe("mock");
  });

  it("completes mock scan → confirm → Max Buy → Purchased → draft → Copy and a livestream guess on the same store", async () => {
    const app = mockPortsApp();

    const health = await json<Record<string, unknown>>(app, "/health");
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({
      catalog: "mock",
      recognition: "mock",
      livestreamIdentify: "yolo_identity",
      gradeEstimate: "mock",
    });
    expect(healthLeaksSecrets(health.body)).toBe(false);
    expect(JSON.stringify(health.body)).not.toMatch(/api[_ -]?key/i);

    const before = await json<{ items: unknown[] }>(app, "/v1/inventory");
    expect(before.body.items).toEqual([]);

    const scan = await json<{
      scan: {
        scanId: string;
        cardflowCardId: string | null;
        inventoryItemId: string | null;
        mapping: { cardsightCardId: string | null; cardflowCardId: string | null };
      };
    }>(app, "/v1/scans", {
      method: "POST",
      body: JSON.stringify({ captureMethod: "camera_photo", scenario: "high-confidence" }),
    });
    expect(scan.status).toBe(201);
    expect(scan.body.scan.cardflowCardId).toBeNull();
    expect(scan.body.scan.inventoryItemId).toBeNull();
    expect(scan.body.scan.mapping.cardflowCardId).toBeNull();
    expect(scan.body.scan.mapping.cardsightCardId).toBe(CARDSIGHT_VENDOR_ID);

    const afterScan = await json<{ items: unknown[] }>(app, "/v1/inventory");
    expect(afterScan.body.items).toHaveLength(0);

    const confirmed = await json<{
      scan: { cardflowCardId: string };
      confirmation: { confirmationId: string; mintedCardflowCardId: boolean };
      canonicalCard: { cardflowCardId: string; tcgdexId: string; cardsightCardId: string | null };
    }>(app, `/v1/scans/${scan.body.scan.scanId}/confirm`, {
      method: "POST",
      body: JSON.stringify({ tcgdexId: "base1-58" }),
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.confirmation.mintedCardflowCardId).toBe(true);
    expect(confirmed.body.canonicalCard.tcgdexId).toBe("base1-58");
    expect(confirmed.body.canonicalCard.cardsightCardId).toBe(CARDSIGHT_VENDOR_ID);
    expect(confirmed.body.canonicalCard.cardflowCardId).not.toBe("base1-58");
    expect(confirmed.body.canonicalCard.cardflowCardId).not.toBe(CARDSIGHT_VENDOR_ID);

    const afterConfirm = await json<{ items: unknown[] }>(app, "/v1/inventory");
    expect(afterConfirm.body.items).toHaveLength(0);

    const maxBuy = await json<{
      maxBuy: { maxBuyAmount: string | null; currency: string };
    }>(app, "/v1/max-buy", {
      method: "POST",
      body: JSON.stringify({ referencePriceAmount: "8.25", condition: "NM" }),
    });
    expect(maxBuy.status).toBe(200);
    expect(maxBuy.body.maxBuy.maxBuyAmount).toBeTruthy();
    expect(maxBuy.body.maxBuy.currency).toBe(LOCKED_DISPLAY_CURRENCY);

    const purchased = await json<{
      item: { inventoryItemId: string; intent: string };
    }>(app, "/v1/inventory/purchased", {
      method: "POST",
      body: JSON.stringify({
        confirmationId: confirmed.body.confirmation.confirmationId,
        purchasePrice: "10.50",
        purchasedAt: "2026-09-16",
        shipping: "1.25",
        referencePriceAmount: "8.25",
        condition: "NM",
      }),
    });
    expect(purchased.status).toBe(201);
    expect(purchased.body.item.intent).toBe("purchased");

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
        published: boolean;
        plainText: string;
      };
    }>(app, `/v1/drafts/${draft.body.draft.draftId}/clipboard`);
    expect(copy.status).toBe(200);
    expect(copy.body.clipboard.omittedPrivateNotes).toBe(true);
    expect(copy.body.clipboard.published).toBe(false);
    expect(copy.body.clipboard.plainText).toContain("USD");
    expect(copy.body.clipboard.plainText).not.toContain("Private");
    expect(copy.body.clipboard.plainText).not.toContain("eBay");

    const afterCrm = await json<{ items: unknown[] }>(app, "/v1/inventory");
    expect(afterCrm.body.items).toHaveLength(1);

    const guess = await json<{
      guess: {
        tcgdexId: string;
        currency: string;
        writesInventory: boolean;
        referenceSource: string;
      };
    }>(app, "/v1/livestream/guesses/base1-58");
    expect(guess.status).toBe(200);
    expect(guess.body.guess).toMatchObject({
      tcgdexId: "base1-58",
      currency: LOCKED_DISPLAY_CURRENCY,
      writesInventory: false,
      referenceSource: PRICE_ESTIMATE_REFERENCE_SOURCE,
    });
    expect(JSON.stringify(guess.body)).not.toMatch(/cardflowCardId|cardflow_card_id/);

    const afterGuess = await json<{ items: unknown[] }>(app, "/v1/inventory");
    expect(afterGuess.body.items).toHaveLength(afterCrm.body.items.length);
  });

  it("survives API reopen; session + draft Copy still omit notes", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cardflow-validation-loop-"));
    tempDirs.push(dir);
    const sqlitePath = path.join(dir, "cardflow.sqlite");
    const firstStore = createSqliteStore({ sqlitePath });
    stores.push(firstStore);
    const firstApp = mockPortsApp(firstStore);

    const session = await json<{ identity: { userId: string } }>(firstApp, "/v1/identity");
    expect(session.status).toBe(200);
    const userId = session.body.identity.userId;

    const scan = await json<{ scan: { scanId: string } }>(firstApp, "/v1/scans", {
      method: "POST",
      body: JSON.stringify({ captureMethod: "camera_photo", scenario: "high-confidence" }),
    });
    const confirmed = await json<{
      confirmation: { confirmationId: string };
    }>(firstApp, `/v1/scans/${scan.body.scan.scanId}/confirm`, {
      method: "POST",
      body: JSON.stringify({ tcgdexId: "base1-58" }),
    });
    const purchased = await json<{ item: { inventoryItemId: string } }>(
      firstApp,
      "/v1/inventory/purchased",
      {
        method: "POST",
        body: JSON.stringify({
          confirmationId: confirmed.body.confirmation.confirmationId,
          purchasePrice: "10.50",
          purchasedAt: "2026-09-16",
        }),
      },
    );
    const draft = await json<{ draft: { draftId: string } }>(
      firstApp,
      `/v1/inventory/${purchased.body.item.inventoryItemId}/drafts`,
      { method: "POST" },
    );
    await json(firstApp, `/v1/drafts/${draft.body.draft.draftId}`, {
      method: "PATCH",
      body: JSON.stringify({ askingPrice: "15.00", notes: PRIVATE_NOTES }),
    });

    firstStore.close();
    stores.pop();
    const reopened = createSqliteStore({ sqlitePath });
    stores.push(reopened);
    const app = mockPortsApp(reopened);

    const identity = await json<{ identity: { userId: string } }>(app, "/v1/identity");
    expect(identity.body.identity.userId).toBe(userId);

    const inventory = await json<{
      items: Array<{ draft: { draftId: string } | null }>;
    }>(app, "/v1/inventory");
    expect(inventory.body.items).toHaveLength(1);
    expect(inventory.body.items[0]?.draft?.draftId).toBe(draft.body.draft.draftId);

    const copy = await json<{
      clipboard: { omittedPrivateNotes: boolean; plainText: string };
    }>(app, `/v1/drafts/${draft.body.draft.draftId}/clipboard`);
    expect(copy.body.clipboard.omittedPrivateNotes).toBe(true);
    expect(copy.body.clipboard.plainText).not.toContain("Private");
  });
});
