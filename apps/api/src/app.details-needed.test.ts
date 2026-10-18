import { describe, expect, it } from "vitest";
import {
  collectionTileValue,
  computeCostToAskSpread,
  computeMaxBuy,
  DEFAULT_MAX_BUY_PREFERENCES,
  DETAILS_NEEDED_WORKFLOW_STATE,
  isClosedWatchlist,
  isDetailsNeededPurchase,
  livestreamContextTags,
  mockCardRecognitionProvider,
  mockTcgdexCatalogProvider,
  purchasedAllInAmount,
  WATCHLIST_CLOSED_WORKFLOW_STATE,
  WATCHLIST_SOURCE_TAG,
  watchlistSourceIdFromTags,
} from "@cardflow/shared";
import { createApp } from "./app";
import { createSqliteStore } from "./sqlite-store";

type App = ReturnType<typeof createApp>;

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

function mockPortsApp() {
  return createApp(createSqliteStore({ sqlitePath: ":memory:" }), {
    catalog: mockTcgdexCatalogProvider,
    recognition: mockCardRecognitionProvider,
  });
}

async function confirmPikachu(app: App) {
  const scan = await json<{ scan: { scanId: string } }>(app, "/v1/scans", {
    method: "POST",
    body: JSON.stringify({ captureMethod: "manual_scan", scenario: "high-confidence" }),
  });
  expect(scan.status).toBe(201);
  const confirmed = await json<{
    confirmation: { confirmationId: string };
    canonicalCard: { cardflowCardId: string; tcgdexId: string };
  }>(app, `/v1/scans/${scan.body.scan.scanId}/confirm`, {
    method: "POST",
    body: JSON.stringify({ tcgdexId: "base1-58" }),
  });
  expect(confirmed.status).toBe(200);
  return confirmed.body;
}

describe("details-needed livestream Purchased", () => {
  it("saves identity, local stream context, and a timestamp with empty cost fields", async () => {
    const app = mockPortsApp();
    const confirmed = await confirmPikachu(app);

    const saved = await json<{
      item: {
        intent: string;
        workflowState: string;
        tags: string[];
        createdAt: string;
        purchase: { costBasis: { purchasePrice: string | null; allInTotal: string | null } } | null;
        cardflowCardId: string;
      };
    }>(app, "/v1/inventory/purchased", {
      method: "POST",
      body: JSON.stringify({
        confirmationId: confirmed.confirmation.confirmationId,
        detailsNeeded: true,
        platform: "whatnot",
        streamUrl: "https://www.whatnot.com",
      }),
    });

    expect(saved.status).toBe(201);
    expect(saved.body.item.intent).toBe("purchased");
    expect(saved.body.item.workflowState).toBe(DETAILS_NEEDED_WORKFLOW_STATE);
    expect(saved.body.item.purchase?.costBasis.purchasePrice).toBeNull();
    expect(saved.body.item.purchase?.costBasis.allInTotal).toBeNull();
    expect(saved.body.item.purchase?.costBasis.purchasePrice).not.toBe("0.00");
    expect(saved.body.item.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(saved.body.item.tags).toEqual(
      livestreamContextTags({
        platform: "whatnot",
        streamUrl: "https://www.whatnot.com",
      }),
    );
    expect(isDetailsNeededPurchase(saved.body.item)).toBe(true);
    expect(purchasedAllInAmount(saved.body.item)).toBeNull();

    const listed = await json<{
      items: Array<{
        workflowState: string;
        purchase: { costBasis: { purchasePrice: string | null; allInTotal: string | null } } | null;
      }>;
    }>(app, "/v1/inventory");
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0]?.workflowState).toBe(DETAILS_NEEDED_WORKFLOW_STATE);
    expect(listed.body.items[0]?.purchase?.costBasis.purchasePrice).toBeNull();
  });

  it("excludes details-needed copies from all-in totals and cost-to-ask spread until completed", async () => {
    const app = mockPortsApp();
    const confirmed = await confirmPikachu(app);
    const saved = await json<{
      item: {
        inventoryItemId: string;
        intent: "purchased";
        workflowState: string;
        purchase: { costBasis: { purchasePrice: string | null; allInTotal?: string | null } };
      };
    }>(app, "/v1/inventory/purchased", {
      method: "POST",
      body: JSON.stringify({
        confirmationId: confirmed.confirmation.confirmationId,
        detailsNeeded: true,
        platform: "ebay",
        streamUrl: "https://www.ebay.com/ebaylive",
      }),
    });
    expect(saved.status).toBe(201);

    expect(
      collectionTileValue(
        {
          intent: saved.body.item.intent,
          workflowState: saved.body.item.workflowState,
          purchase: saved.body.item.purchase,
        },
        DEFAULT_MAX_BUY_PREFERENCES,
      ),
    ).toEqual({ allInAmount: null, targetMaxBuyDisplay: null });
    expect(
      computeCostToAskSpread({
        askingPrice: "20.00",
        allInTotal: purchasedAllInAmount(saved.body.item),
        workflowState: saved.body.item.workflowState,
      }),
    ).toBeNull();

    const draft = await json<{ error: string }>(
      app,
      `/v1/inventory/${saved.body.item.inventoryItemId}/drafts`,
      { method: "POST" },
    );
    expect(draft.status).toBe(409);
    expect(draft.body.error).toMatch(/details/i);

    const replay = await json<{ created?: boolean; item: { inventoryItemId: string } }>(
      app,
      "/v1/inventory/purchased",
      {
        method: "POST",
        body: JSON.stringify({
          confirmationId: confirmed.confirmation.confirmationId,
          detailsNeeded: true,
          platform: "ebay",
          streamUrl: "https://www.ebay.com/ebaylive",
        }),
      },
    );
    expect(replay.status).toBe(200);
    expect(replay.body.created).toBe(false);
    expect(replay.body.item.inventoryItemId).toBe(saved.body.item.inventoryItemId);
  });

  it("completes details into a normal Purchased record with cost basis", async () => {
    const app = mockPortsApp();
    const confirmed = await confirmPikachu(app);
    const saved = await json<{
      item: {
        inventoryItemId: string;
        workflowState: string;
        purchase: { costBasis: { purchasePrice: string | null; allInTotal?: string | null } };
      };
    }>(app, "/v1/inventory/purchased", {
      method: "POST",
      body: JSON.stringify({
        confirmationId: confirmed.confirmation.confirmationId,
        detailsNeeded: true,
        platform: "whatnot",
        streamUrl: "https://www.whatnot.com",
      }),
    });
    expect(saved.status).toBe(201);

    const missing = await json<{ error: string }>(
      app,
      `/v1/inventory/${saved.body.item.inventoryItemId}/purchase`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );
    expect(missing.status).toBe(400);

    const completed = await json<{
      item: {
        workflowState: string;
        purchase: { currency: string; costBasis: { allInTotal: string; purchasePrice: string } };
      };
    }>(app, `/v1/inventory/${saved.body.item.inventoryItemId}/purchase`, {
      method: "POST",
      body: JSON.stringify({
        purchasePrice: "10.50",
        purchasedAt: "2026-10-11T22:40:00.000Z",
        shipping: "0.00",
        tax: "0.00",
        fees: "0.00",
        supplies: "0.00",
      }),
    });

    expect(completed.status).toBe(200);
    expect(completed.body.item.workflowState).toBe("acquired");
    expect(completed.body.item.purchase.currency).toBe("USD");
    expect(completed.body.item.purchase.costBasis.purchasePrice).toBe("10.50");
    expect(completed.body.item.purchase.costBasis.allInTotal).toBe("10.50");
    expect(isDetailsNeededPurchase(completed.body.item)).toBe(false);
    expect(purchasedAllInAmount(completed.body.item)).toBe("10.50");
    expect(
      collectionTileValue(
        {
          intent: "purchased",
          workflowState: completed.body.item.workflowState,
          allInTotal: completed.body.item.purchase.costBasis.allInTotal,
          purchase: completed.body.item.purchase,
        },
        DEFAULT_MAX_BUY_PREFERENCES,
      ).allInAmount,
    ).toBe("10.50");

    const listed = await json<{
      items: Array<{ workflowState: string; purchase: { costBasis: { allInTotal: string } } | null }>;
    }>(app, "/v1/inventory");
    expect(listed.body.items[0]?.workflowState).toBe("acquired");
    expect(listed.body.items[0]?.purchase?.costBasis.allInTotal).toBe("10.50");
  });

  it("undo within the toast window leaves no Purchased row behind", async () => {
    const app = mockPortsApp();
    const confirmed = await confirmPikachu(app);
    const saved = await json<{ item: { inventoryItemId: string } }>(app, "/v1/inventory/purchased", {
      method: "POST",
      body: JSON.stringify({
        confirmationId: confirmed.confirmation.confirmationId,
        detailsNeeded: true,
        platform: "whatnot",
        streamUrl: "https://www.whatnot.com",
      }),
    });
    expect(saved.status).toBe(201);

    const undone = await json<{ ok: true; deleted: true }>(
      app,
      `/v1/inventory/${saved.body.item.inventoryItemId}`,
      { method: "DELETE" },
    );
    expect(undone.status).toBe(200);
    expect(undone.body.deleted).toBe(true);

    const listed = await json<{ items: unknown[] }>(app, "/v1/inventory");
    expect(listed.body.items).toHaveLength(0);

    const missing = await json<{ error: string }>(
      app,
      `/v1/inventory/${saved.body.item.inventoryItemId}`,
      { method: "DELETE" },
    );
    expect(missing.status).toBe(404);

    const again = await json<{
      item: { inventoryItemId: string; workflowState: string };
    }>(app, "/v1/inventory/purchased", {
      method: "POST",
      body: JSON.stringify({
        confirmationId: confirmed.confirmation.confirmationId,
        detailsNeeded: true,
        platform: "whatnot",
        streamUrl: "https://www.whatnot.com",
      }),
    });
    expect(again.status).toBe(201);
    expect(again.body.item.inventoryItemId).not.toBe(saved.body.item.inventoryItemId);
    expect(again.body.item.workflowState).toBe(DETAILS_NEEDED_WORKFLOW_STATE);
  });

  it("does not undo a Purchased copy after details are completed", async () => {
    const app = mockPortsApp();
    const confirmed = await confirmPikachu(app);
    const saved = await json<{ item: { inventoryItemId: string } }>(app, "/v1/inventory/purchased", {
      method: "POST",
      body: JSON.stringify({
        confirmationId: confirmed.confirmation.confirmationId,
        detailsNeeded: true,
      }),
    });
    expect(saved.status).toBe(201);

    const completed = await json<{ item: { workflowState: string } }>(
      app,
      `/v1/inventory/${saved.body.item.inventoryItemId}/purchase`,
      {
        method: "POST",
        body: JSON.stringify({
          purchasePrice: "10.50",
          purchasedAt: "2026-10-11T22:40:00.000Z",
        }),
      },
    );
    expect(completed.status).toBe(200);
    expect(completed.body.item.workflowState).toBe("acquired");

    const blocked = await json<{ error: string }>(
      app,
      `/v1/inventory/${saved.body.item.inventoryItemId}`,
      { method: "DELETE" },
    );
    expect(blocked.status).toBe(409);

    const listed = await json<{ items: Array<{ inventoryItemId: string }> }>(app, "/v1/inventory");
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0]?.inventoryItemId).toBe(saved.body.item.inventoryItemId);
  });
});

describe("one-tap Watchlist → Purchased", () => {
  async function saveWatchlist(app: App, confirmationId: string) {
    return json<{
      item: {
        inventoryItemId: string;
        cardflowCardId: string;
        confirmationId: string;
        selectedVariant: string | null;
        condition: string | null;
        referencePriceAmount: string | null;
        targetMaxBuyAmount: string | null;
        scanId: string;
      };
    }>(app, "/v1/inventory/watchlist", {
      method: "POST",
      body: JSON.stringify({
        confirmationId,
        selectedVariant: "holo",
        referencePriceAmount: "8.00",
        condition: "NM",
      }),
    });
  }

  it("carries TCGdex identity, variant, and Max Buy snapshot without a new scan", async () => {
    const app = mockPortsApp();
    const confirmed = await confirmPikachu(app);
    const watchlist = await saveWatchlist(app, confirmed.confirmation.confirmationId);
    expect(watchlist.status).toBe(201);
    const expectedMaxBuy = computeMaxBuy({
      referencePriceAmount: "8.00",
      condition: "NM",
      preferences: DEFAULT_MAX_BUY_PREFERENCES,
    });

    const converted = await json<{
      created?: boolean;
      item: {
        inventoryItemId: string;
        intent: string;
        workflowState: string;
        cardflowCardId: string;
        confirmationId: string;
        scanId: string;
        selectedVariant: string | null;
        condition: string | null;
        tags: string[];
        referencePriceAmount: string | null;
        targetMaxBuyAmount: string | null;
        purchase: {
          costBasis: { purchasePrice: string | null; allInTotal: string | null };
          maxBuy: { maxBuyAmount: string | null };
        } | null;
        card: { tcgdexId: string } | null;
      };
    }>(app, `/v1/inventory/${watchlist.body.item.inventoryItemId}/purchased`, {
      method: "POST",
    });

    expect(converted.status).toBe(201);
    expect(converted.body.created).toBe(true);
    expect(converted.body.item.intent).toBe("purchased");
    expect(converted.body.item.workflowState).toBe(DETAILS_NEEDED_WORKFLOW_STATE);
    expect(converted.body.item.cardflowCardId).toBe(watchlist.body.item.cardflowCardId);
    expect(converted.body.item.confirmationId).toBe(watchlist.body.item.confirmationId);
    expect(converted.body.item.scanId).toBe(watchlist.body.item.scanId);
    expect(converted.body.item.selectedVariant).toBe("holo");
    expect(converted.body.item.condition).toBe("NM");
    expect(converted.body.item.card?.tcgdexId).toBe(confirmed.canonicalCard.tcgdexId);
    expect(converted.body.item.referencePriceAmount).toBe("8.00");
    expect(converted.body.item.targetMaxBuyAmount).toBe(expectedMaxBuy.maxBuyAmount);
    expect(converted.body.item.purchase?.maxBuy.maxBuyAmount).toBe(expectedMaxBuy.maxBuyAmount);
    expect(converted.body.item.purchase?.costBasis.purchasePrice).toBeNull();
    expect(converted.body.item.purchase?.costBasis.allInTotal).toBeNull();
    expect(isDetailsNeededPurchase(converted.body.item)).toBe(true);
    expect(watchlistSourceIdFromTags(converted.body.item.tags)).toBe(
      watchlist.body.item.inventoryItemId,
    );
    expect(converted.body.item.tags).toContain(WATCHLIST_SOURCE_TAG);
    expect(
      collectionTileValue(
        {
          intent: "purchased",
          workflowState: converted.body.item.workflowState,
          targetMaxBuyAmount: converted.body.item.targetMaxBuyAmount,
          purchase: converted.body.item.purchase,
        },
        DEFAULT_MAX_BUY_PREFERENCES,
      ),
    ).toEqual({
      allInAmount: null,
      targetMaxBuyDisplay: `$${expectedMaxBuy.maxBuyAmount}`,
    });

    const listed = await json<{
      items: Array<{
        inventoryItemId: string;
        intent: string;
        workflowState: string;
        selectedVariant: string | null;
        targetMaxBuyAmount: string | null;
        card: { tcgdexId: string } | null;
      }>;
    }>(app, "/v1/inventory");
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0]?.inventoryItemId).toBe(converted.body.item.inventoryItemId);
    expect(listed.body.items[0]?.intent).toBe("purchased");
    expect(listed.body.items[0]?.selectedVariant).toBe("holo");
    expect(listed.body.items[0]?.targetMaxBuyAmount).toBe(expectedMaxBuy.maxBuyAmount);
    expect(listed.body.items[0]?.card?.tcgdexId).toBe(confirmed.canonicalCard.tcgdexId);

    const closed = await json<{
      item: { workflowState: string; closedAt?: string | null; intent: string };
    }>(app, `/v1/inventory/${watchlist.body.item.inventoryItemId}`);
    expect(closed.status).toBe(200);
    expect(closed.body.item.intent).toBe("watchlist");
    expect(closed.body.item.workflowState).toBe(WATCHLIST_CLOSED_WORKFLOW_STATE);
    expect(isClosedWatchlist(closed.body.item)).toBe(true);

    const replay = await json<{
      created?: boolean;
      item: { inventoryItemId: string };
    }>(app, `/v1/inventory/${watchlist.body.item.inventoryItemId}/purchased`, {
      method: "POST",
    });
    expect(replay.status).toBe(200);
    expect(replay.body.created).toBe(false);
    expect(replay.body.item.inventoryItemId).toBe(converted.body.item.inventoryItemId);
  });

  it("undo restores the Watchlist row and leaves no Purchased copy", async () => {
    const app = mockPortsApp();
    const confirmed = await confirmPikachu(app);
    const watchlist = await saveWatchlist(app, confirmed.confirmation.confirmationId);
    const converted = await json<{ item: { inventoryItemId: string } }>(
      app,
      `/v1/inventory/${watchlist.body.item.inventoryItemId}/purchased`,
      { method: "POST" },
    );
    expect(converted.status).toBe(201);

    const undone = await json<{ ok: true; deleted: true }>(
      app,
      `/v1/inventory/${converted.body.item.inventoryItemId}`,
      { method: "DELETE" },
    );
    expect(undone.status).toBe(200);

    const listed = await json<{
      items: Array<{
        inventoryItemId: string;
        intent: string;
        workflowState: string;
        selectedVariant: string | null;
        targetMaxBuyAmount: string | null;
      }>;
    }>(app, "/v1/inventory");
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0]?.inventoryItemId).toBe(watchlist.body.item.inventoryItemId);
    expect(listed.body.items[0]?.intent).toBe("watchlist");
    expect(listed.body.items[0]?.workflowState).toBe("watching");
    expect(listed.body.items[0]?.selectedVariant).toBe("holo");

    const missing = await json<{ error: string }>(
      app,
      `/v1/inventory/${converted.body.item.inventoryItemId}`,
      { method: "DELETE" },
    );
    expect(missing.status).toBe(404);
  });
});
