import { afterEach, describe, expect, it } from "vitest";
import { CONFIRM_COULD_NOT_CONFIRM_MESSAGE, createDisabledTcgdexCatalogProvider } from "@cardflow/shared";
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

describe("GET /v1/catalog/search", () => {
  const stores: SqliteStorePort[] = [];

  afterEach(() => {
    for (const store of stores.splice(0)) {
      store.close();
    }
  });

  function openApp(catalog?: import("@cardflow/shared").CardCatalogProvider) {
    const store = createSqliteStore({ sqlitePath: ":memory:" });
    stores.push(store);
    return { store, app: createApp(store, catalog ? { catalog } : undefined) };
  }

  it("returns base1-58 for English set + number without writing inventory", async () => {
    const { app } = openApp();
    const before = await json<{ items: unknown[] }>(app, "/v1/inventory");

    const searched = await json<{
      ok: boolean;
      autoConfirm: boolean;
      userConfirmationRequired: boolean;
      cards: Array<{ tcgdexId: string; cardflowCardId: string | null }>;
    }>(app, "/v1/catalog/search?set=Base%20Set&number=58");

    expect(searched.status).toBe(200);
    expect(searched.body.autoConfirm).toBe(false);
    expect(searched.body.userConfirmationRequired).toBe(true);
    expect(searched.body.cards).toEqual([
      expect.objectContaining({ tcgdexId: "base1-58", cardflowCardId: null }),
    ]);
    expect(JSON.stringify(searched.body)).not.toContain("pricing");

    const inventory = await json<{ items: unknown[] }>(app, "/v1/inventory");
    expect(inventory.body.items).toHaveLength(before.body.items.length);
  });

  it("lets a tester Confirm a bad still via search and save Purchased", async () => {
    const { app } = openApp();
    const before = await json<{ items: unknown[] }>(app, "/v1/inventory");

    const scan = await json<{
      scan: {
        scanId: string;
        cardflowCardId: string | null;
        inventoryItemId: string | null;
        mapping: { status: string; tcgdexId: string | null; userConfirmation: { recommendedUx: string } };
        recognition: { ok: boolean; detections: unknown[] };
      };
    }>(app, "/v1/scans", {
      method: "POST",
      body: JSON.stringify({ captureMethod: "camera_photo", scenario: "no-card" }),
    });
    expect(scan.status).toBe(201);
    expect(scan.body.scan.cardflowCardId).toBeNull();
    expect(scan.body.scan.inventoryItemId).toBeNull();
    expect(scan.body.scan.recognition.ok).toBe(true);
    expect(scan.body.scan.recognition.detections).toEqual([]);
    expect(scan.body.scan.mapping.status).toBe("no_match");
    expect(scan.body.scan.mapping.userConfirmation.recommendedUx).toBe(
      CONFIRM_COULD_NOT_CONFIRM_MESSAGE,
    );

    const searched = await json<{ cards: Array<{ tcgdexId: string }> }>(
      app,
      "/v1/catalog/search?set=Base%20Set&number=58",
    );
    expect(searched.body.cards.map((card) => card.tcgdexId)).toEqual(["base1-58"]);

    const confirmed = await json<{
      confirmation: { confirmationId: string; tcgdexId: string; matchMethod: string };
      scan: { inventoryItemId: string | null };
    }>(app, `/v1/scans/${scan.body.scan.scanId}/confirm`, {
      method: "POST",
      body: JSON.stringify({ tcgdexId: "base1-58" }),
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.confirmation.matchMethod).toBe("manual");
    expect(confirmed.body.scan.inventoryItemId).toBeNull();

    const purchased = await json<{
      item: { inventoryItemId: string; intent: string; workflowState: string };
    }>(app, "/v1/inventory/purchased", {
      method: "POST",
      body: JSON.stringify({
        confirmationId: confirmed.body.confirmation.confirmationId,
        purchasePrice: "4.00",
        purchasedAt: "2026-09-17",
      }),
    });
    expect(purchased.status).toBe(201);
    expect(purchased.body.item.intent).toBe("purchased");

    const inventory = await json<{ items: Array<{ inventoryItemId: string }> }>(app, "/v1/inventory");
    expect(inventory.body.items.length).toBe(before.body.items.length + 1);
  });

  it("lets a tester Confirm base1-58 from search when identify mapping is empty", async () => {
    const { app } = openApp();
    const before = await json<{ items: unknown[] }>(app, "/v1/inventory");

    const scan = await json<{
      scan: {
        scanId: string;
        cardflowCardId: string | null;
        inventoryItemId: string | null;
        mapping: { status: string; tcgdexId: string | null; candidates: unknown[] };
        recognition: { ok: boolean };
      };
    }>(app, "/v1/scans", {
      method: "POST",
      body: JSON.stringify({ captureMethod: "camera_photo", scenario: "no-match" }),
    });
    expect(scan.status).toBe(201);
    expect(scan.body.scan.cardflowCardId).toBeNull();
    expect(scan.body.scan.inventoryItemId).toBeNull();
    expect(scan.body.scan.mapping.status).toBe("no_match");
    expect(scan.body.scan.mapping.tcgdexId).toBeNull();
    expect(scan.body.scan.mapping.candidates).toEqual([]);

    const searched = await json<{ cards: Array<{ tcgdexId: string }> }>(
      app,
      "/v1/catalog/search?set=base1&number=58",
    );
    expect(searched.body.cards.map((card) => card.tcgdexId)).toEqual(["base1-58"]);

    const confirmed = await json<{
      confirmation: { tcgdexId: string; matchMethod: string; cardflowCardId: string };
      canonicalCard: { tcgdexId: string; cardflowCardId: string };
      scan: { cardflowCardId: string; inventoryItemId: string | null };
    }>(app, `/v1/scans/${scan.body.scan.scanId}/confirm`, {
      method: "POST",
      body: JSON.stringify({ tcgdexId: "base1-58" }),
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.canonicalCard.tcgdexId).toBe("base1-58");
    expect(confirmed.body.confirmation.matchMethod).toBe("manual");
    expect(confirmed.body.scan.inventoryItemId).toBeNull();

    const inventory = await json<{ items: unknown[] }>(app, "/v1/inventory");
    expect(inventory.body.items).toHaveLength(before.body.items.length);
  });

  it("does not auto-confirm name-only search or High+High identify", async () => {
    const { app } = openApp();

    const nameOnly = await json<{
      autoConfirm: boolean;
      nameOnly: boolean;
      cards: Array<{ tcgdexId: string }>;
    }>(app, "/v1/catalog/search?name=Pikachu");
    expect(nameOnly.status).toBe(200);
    expect(nameOnly.body.nameOnly).toBe(true);
    expect(nameOnly.body.autoConfirm).toBe(false);
    expect(nameOnly.body.cards.some((card) => card.tcgdexId === "base1-58")).toBe(true);

    const high = await json<{
      scan: {
        mapping: {
          status: string;
          userConfirmation: { required: boolean; crmWriteAllowedBeforeConfirm: boolean };
        };
        cardflowCardId: string | null;
        inventoryItemId: string | null;
      };
    }>(app, "/v1/scans", {
      method: "POST",
      body: JSON.stringify({ captureMethod: "camera_photo", scenario: "high-confidence" }),
    });
    expect(high.body.scan.mapping.status).toBe("matched");
    expect(high.body.scan.mapping.userConfirmation.required).toBe(true);
    expect(high.body.scan.mapping.userConfirmation.crmWriteAllowedBeforeConfirm).toBe(false);
    expect(high.body.scan.cardflowCardId).toBeNull();
    expect(high.body.scan.inventoryItemId).toBeNull();
  });

  it("shows last-good cached catalog when the live catalog is off", async () => {
    const { app, store } = openApp();
    const scan = await json<{ scan: { scanId: string } }>(app, "/v1/scans", {
      method: "POST",
      body: JSON.stringify({ captureMethod: "camera_photo", scenario: "high-confidence" }),
    });
    await json(app, `/v1/scans/${scan.body.scan.scanId}/confirm`, {
      method: "POST",
      body: JSON.stringify({ tcgdexId: "base1-58" }),
    });

    const down = createApp(store, { catalog: createDisabledTcgdexCatalogProvider() });
    const searched = await json<{
      cached: boolean;
      autoConfirm: boolean;
      cards: Array<{ tcgdexId: string }>;
      error: { code: string } | null;
      notice: string | null;
    }>(down, "/v1/catalog/search?set=Base%20Set&number=58");

    expect(searched.status).toBe(200);
    expect(searched.body.cached).toBe(true);
    expect(searched.body.autoConfirm).toBe(false);
    expect(searched.body.cards[0]?.tcgdexId).toBe("base1-58");
    expect(searched.body.error?.code).toBe("FEATURE_DISABLED");
    expect(searched.body.notice?.toLowerCase()).toContain("cached");
  });

  it("rejects an empty search query", async () => {
    const { app } = openApp();
    const empty = await json<{ error: string }>(app, "/v1/catalog/search");
    expect(empty.status).toBe(400);
    expect(empty.body.error.toLowerCase()).toContain("set and number");
  });
});
