import { describe, expect, it } from "vitest";
import {
  collectionTileValue,
  computeCostToAskSpread,
  DEFAULT_MAX_BUY_PREFERENCES,
  DETAILS_NEEDED_WORKFLOW_STATE,
  isDetailsNeededPurchase,
  livestreamContextTags,
  mockCardRecognitionProvider,
  mockTcgdexCatalogProvider,
  purchasedAllInAmount,
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
        purchase: unknown;
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
    expect(saved.body.item.purchase).toBeNull();
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
        purchase: { costBasis: { allInTotal: string } } | null;
      }>;
    }>(app, "/v1/inventory");
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0]?.workflowState).toBe(DETAILS_NEEDED_WORKFLOW_STATE);
    expect(listed.body.items[0]?.purchase).toBeNull();
  });

  it("excludes details-needed copies from all-in totals and cost-to-ask spread until completed", async () => {
    const app = mockPortsApp();
    const confirmed = await confirmPikachu(app);
    const saved = await json<{
      item: {
        inventoryItemId: string;
        intent: "purchased";
        workflowState: string;
        purchase: null;
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
      item: { inventoryItemId: string; workflowState: string; purchase: null };
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
});
