import { afterEach, describe, expect, it } from "vitest";
import {
  createDisabledTcgdexCatalogProvider,
  mockTcgdexCatalogProvider,
  type CardCatalogProvider,
  type CardFlowCanonicalCard,
} from "@cardflow/shared";
import { createApp } from "./app";
import { createSqliteStore, type SqliteStorePort } from "./sqlite-store";

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

function expectNoPricing(value: unknown) {
  expect(JSON.stringify(value)).not.toMatch(/"pricing"\s*:/);
}

function expectTcgdexCatalogArt(url: string | null | undefined) {
  expect(url).toContain("assets.tcgdex.net");
  expect(url).not.toContain("/v1/scans/");
}

function catalogWithName(name: string): CardCatalogProvider {
  return {
    name: "mock",
    async getCardById(id, language) {
      const card = await mockTcgdexCatalogProvider.getCardById(id, language);
      return card ? { ...card, name } : null;
    },
    getCardBySetAndLocalId(setId, localId, language) {
      return mockTcgdexCatalogProvider.getCardBySetAndLocalId(setId, localId, language);
    },
    resolveSetByName(setName, language) {
      return mockTcgdexCatalogProvider.resolveSetByName(setName, language);
    },
    listCards(req) {
      return mockTcgdexCatalogProvider.listCards(req);
    },
  };
}

async function confirmCard(app: App, tcgdexId: string) {
  const scan = await json<{ scan: { scanId: string } }>(app, "/v1/scans", {
    method: "POST",
    body: JSON.stringify({ captureMethod: "camera_photo", scenario: "high-confidence" }),
  });
  expect(scan.status).toBe(201);

  const confirmed = await json<{
    confirmation: { confirmationId: string; cardflowCardId: string; mintedCardflowCardId: boolean };
    canonicalCard: CardFlowCanonicalCard;
  }>(app, `/v1/scans/${scan.body.scan.scanId}/confirm`, {
    method: "POST",
    body: JSON.stringify({ tcgdexId }),
  });
  expect(confirmed.status).toBe(200);
  return confirmed.body;
}

describe("confirm caches catalog on the canonical row", () => {
  const stores: SqliteStorePort[] = [];

  afterEach(() => {
    for (const store of stores.splice(0)) {
      store.close();
    }
  });

  function openApp(catalog?: CardCatalogProvider) {
    const store = createSqliteStore({ sqlitePath: ":memory:" });
    stores.push(store);
    return { store, app: createApp(store, catalog ? { catalog } : undefined) };
  }

  it("persists name, set, localId, image, and variants after Confirm", async () => {
    const { app } = openApp();
    const confirmed = await confirmCard(app, "base1-58");
    expect(confirmed.confirmation.mintedCardflowCardId).toBe(true);
    expect(confirmed.canonicalCard.name).toBe("Pikachu");
    expect(confirmed.canonicalCard.set.name).toBe("Base Set");
    expect(confirmed.canonicalCard.localId).toBe("58");
    expect(confirmed.canonicalCard.tcgdexSetId).toBe("base1");
    expect(confirmed.canonicalCard.variants.normal).toBe(true);
    expect(confirmed.canonicalCard.image.source).toBe("tcgdex_assets");
    expectTcgdexCatalogArt(confirmed.canonicalCard.image.constructedUrl);
    expectNoPricing(confirmed.canonicalCard);

    const card = await json<{ canonicalCard: CardFlowCanonicalCard }>(
      app,
      `/v1/cards/${confirmed.canonicalCard.cardflowCardId}`,
    );
    expect(card.status).toBe(200);
    expect(card.body.canonicalCard.name).toBe("Pikachu");
    expect(card.body.canonicalCard.set.name).toBe("Base Set");
    expect(card.body.canonicalCard.localId).toBe("58");
    expect(card.body.canonicalCard.image.baseUrl).toContain("assets.tcgdex.net");
    expectTcgdexCatalogArt(card.body.canonicalCard.image.constructedUrl);
    expectNoPricing(card.body.canonicalCard);
  });

  it("refresh updates cache fields and does not change cardflow_card_id", async () => {
    const store = createSqliteStore({ sqlitePath: ":memory:" });
    stores.push(store);
    const firstApp = createApp(store, { catalog: catalogWithName("Pikachu") });
    const first = await confirmCard(firstApp, "base1-58");
    const firstId = first.canonicalCard.cardflowCardId;

    const secondApp = createApp(store, { catalog: catalogWithName("Pikachu refreshed") });
    const second = await confirmCard(secondApp, "base1-58");
    expect(second.confirmation.mintedCardflowCardId).toBe(false);
    expect(second.canonicalCard.cardflowCardId).toBe(firstId);
    expect(second.canonicalCard.name).toBe("Pikachu refreshed");

    const card = await json<{ canonicalCard: { cardflowCardId: string; name: string } }>(
      secondApp,
      `/v1/cards/${firstId}`,
    );
    expect(card.body.canonicalCard.cardflowCardId).toBe(firstId);
    expect(card.body.canonicalCard.name).toBe("Pikachu refreshed");
  });

  it("Detail and Collection still show the confirmed card when catalog is unplugged", async () => {
    const store = createSqliteStore({ sqlitePath: ":memory:" });
    stores.push(store);
    const liveApp = createApp(store, { catalog: mockTcgdexCatalogProvider });
    const confirmed = await confirmCard(liveApp, "base1-58");
    const purchased = await json<{ item: { inventoryItemId: string } }>(
      liveApp,
      "/v1/inventory/purchased",
      {
        method: "POST",
        body: JSON.stringify({
          confirmationId: confirmed.confirmation.confirmationId,
          purchasePrice: "10.50",
          purchasedAt: "2026-09-16",
        }),
      },
    );
    expect(purchased.status).toBe(201);

    const draft = await json<{
      draft: {
        draftId: string;
        catalogDisplay: {
          name: string;
          image: { constructedUrl: string; source: string };
        };
      };
    }>(liveApp, `/v1/inventory/${purchased.body.item.inventoryItemId}/drafts`, {
      method: "POST",
    });
    expect(draft.status).toBe(201);

    const unplugged = createApp(store, { catalog: createDisabledTcgdexCatalogProvider() });

    const liveCatalog = await json<{ ok: boolean }>(unplugged, "/v1/catalog/cards/base1-58");
    expect(liveCatalog.status).toBe(403);

    const detail = await json<{
      canonicalCard: CardFlowCanonicalCard & Record<string, unknown>;
    }>(unplugged, `/v1/cards/${confirmed.canonicalCard.cardflowCardId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.canonicalCard.name).toBe("Pikachu");
    expect(detail.body.canonicalCard.set.name).toBe("Base Set");
    expect(detail.body.canonicalCard.localId).toBe("58");
    expect(detail.body.canonicalCard.variants.normal).toBe(true);
    expect(detail.body.canonicalCard.image.source).toBe("tcgdex_assets");
    expectTcgdexCatalogArt(detail.body.canonicalCard.image.constructedUrl);
    expectNoPricing(detail.body.canonicalCard);

    const inventory = await json<{
      items: Array<{
        card: {
          name: string;
          setName: string;
          localId: string;
          imageUrl: string | null;
        } | null;
      }>;
    }>(unplugged, "/v1/inventory");
    expect(inventory.status).toBe(200);
    expect(inventory.body.items[0]?.card?.name).toBe("Pikachu");
    expect(inventory.body.items[0]?.card?.setName).toBe("Base Set");
    expect(inventory.body.items[0]?.card?.localId).toBe("58");
    expectTcgdexCatalogArt(inventory.body.items[0]?.card?.imageUrl);
    expectNoPricing(inventory.body);

    const savedDraft = await json<{
      draft: {
        catalogDisplay: {
          name: string;
          image: { constructedUrl: string; source: string };
        };
      };
    }>(unplugged, `/v1/drafts/${draft.body.draft.draftId}`);
    expect(savedDraft.body.draft.catalogDisplay.name).toBe("Pikachu");
    expect(savedDraft.body.draft.catalogDisplay.image.source).toBe("tcgdex_assets");
    expectTcgdexCatalogArt(savedDraft.body.draft.catalogDisplay.image.constructedUrl);
    expectNoPricing(savedDraft.body);
  });

  it("does not call the catalog provider for CRM card reads after Confirm", async () => {
    const store = createSqliteStore({ sqlitePath: ":memory:" });
    stores.push(store);
    const liveApp = createApp(store, { catalog: mockTcgdexCatalogProvider });
    const confirmed = await confirmCard(liveApp, "base1-58");
    await json(liveApp, "/v1/inventory/purchased", {
      method: "POST",
      body: JSON.stringify({
        confirmationId: confirmed.confirmation.confirmationId,
        purchasePrice: "10.50",
        purchasedAt: "2026-09-16",
      }),
    });

    let catalogReads = 0;
    const counting: CardCatalogProvider = {
      name: "mock",
      async getCardById(id, language) {
        catalogReads += 1;
        return mockTcgdexCatalogProvider.getCardById(id, language);
      },
      async getCardBySetAndLocalId(setId, localId, language) {
        catalogReads += 1;
        return mockTcgdexCatalogProvider.getCardBySetAndLocalId(setId, localId, language);
      },
      async resolveSetByName(setName, language) {
        catalogReads += 1;
        return mockTcgdexCatalogProvider.resolveSetByName(setName, language);
      },
      async listCards(req) {
        catalogReads += 1;
        return mockTcgdexCatalogProvider.listCards(req);
      },
    };
    const app = createApp(store, { catalog: counting });
    const detail = await json(app, `/v1/cards/${confirmed.canonicalCard.cardflowCardId}`);
    const inventory = await json(app, "/v1/inventory");
    expect(detail.status).toBe(200);
    expect(inventory.status).toBe(200);
    expect(catalogReads).toBe(0);
  });
});
