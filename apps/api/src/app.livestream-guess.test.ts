import jpeg from "jpeg-js";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGE_GATE_VERSION,
  DEFAULT_INVITED_USER_ID,
  computeMaxBuy,
  createDisabledTcgdexCatalogProvider,
  createMockPricingProvider,
  ciPhashIndex,
  ciStillBitmap,
  PRICE_ESTIMATE_REFERENCE_SOURCE,
  rgbPerceptualHash,
} from "@cardflow/shared";
import { createApp } from "./app";
import { createMemoryStore } from "./store";
import { createSqliteStore, type SqliteStorePort } from "./sqlite-store";

type App = ReturnType<typeof createApp>;

function withAge(store: ReturnType<typeof createMemoryStore> | SqliteStorePort) {
  store.ageConfirmations.confirm(DEFAULT_INVITED_USER_ID, AGE_GATE_VERSION, "2026-10-18T00:00:00.000Z");
  return store;
}

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

describe("GET /v1/livestream/guesses/:tcgdexId", () => {
  const stores: SqliteStorePort[] = [];

  afterEach(() => {
    for (const store of stores.splice(0)) {
      store.close();
    }
  });

  it("returns catalog + mock USD estimate + display Max Buy without Docker", async () => {
    const store = createSqliteStore({ sqlitePath: ":memory:" });
    stores.push(store);
    withAge(store);
    const app = createApp(store, { pricing: createMockPricingProvider() });
    const expectedMaxBuy = computeMaxBuy({ referencePriceAmount: "8.25" });

    const before = await json<{ items: unknown[] }>(app, "/v1/inventory");
    const collectionBefore = await json<{ items: unknown[] }>(app, "/v1/collection");

    const response = await json<{
      ok: boolean;
      guess: {
        tcgdexId: string;
        name: string | null;
        setName: string | null;
        number: string | null;
        imageUrl: string | null;
        estimateCents: number | null;
        estimateAmount: string | null;
        maxBuyAmount: string | null;
        maxBuyAmountCents: number | null;
        confidence: string | null;
        referenceSource: string;
        currency: string;
        notConfirmed: boolean;
        writesInventory: boolean;
        cardflowCardId?: string;
      };
    }>(app, "/v1/livestream/guesses/base1-58?confidence=High");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      guess: {
        tcgdexId: "base1-58",
        name: "Pikachu",
        setName: "Base Set",
        number: "58",
        estimateCents: 825,
        estimateAmount: "8.25",
        maxBuyAmount: expectedMaxBuy.maxBuyAmount,
        maxBuyAmountCents: expectedMaxBuy.maxBuyAmountCents,
        confidence: "High",
        referenceSource: PRICE_ESTIMATE_REFERENCE_SOURCE,
        currency: "USD",
        notConfirmed: true,
        writesInventory: false,
      },
    });
    expect(response.body.guess.imageUrl).toBe(
      "https://assets.tcgdex.net/en/base/base1/58/high.webp",
    );
    expect(response.body.guess).not.toHaveProperty("cardflowCardId");
    expect(JSON.stringify(response.body)).not.toMatch(/cardflowCardId|cardflow_card_id/);
    expect(JSON.stringify(response.body)).not.toMatch(/"pricing"\s*:/);
    expect(JSON.stringify(response.body)).not.toContain("price_tcg");
    expect(JSON.stringify(response.body)).not.toContain("127.0.0.1:8000");
    expect(JSON.stringify(response.body)).not.toMatch(/Bearer\s+\S+/);

    const after = await json<{ items: unknown[] }>(app, "/v1/inventory");
    const collectionAfter = await json<{ items: unknown[] }>(app, "/v1/collection");
    expect(after.body.items).toEqual(before.body.items);
    expect(collectionAfter.body.items).toEqual(collectionBefore.body.items);
    expect(after.body.items).toEqual([]);
  });

  it("returns a null estimate when pricing is off and still does not write inventory", async () => {
    const app = createApp(withAge(createMemoryStore()));
    const before = await json<{ items: unknown[] }>(app, "/v1/inventory");

    const response = await json<{
      ok: boolean;
      guess: {
        tcgdexId: string;
        estimateCents: number | null;
        maxBuyAmount: string | null;
        referenceSource: string;
        writesInventory: boolean;
      };
    }>(app, "/v1/livestream/guesses/base1-58");

    expect(response.status).toBe(200);
    expect(response.body.guess).toMatchObject({
      tcgdexId: "base1-58",
      name: "Pikachu",
      estimateCents: null,
      maxBuyAmount: null,
      referenceSource: "none",
      writesInventory: false,
    });

    const after = await json<{ items: unknown[] }>(app, "/v1/inventory");
    expect(after.body.items).toEqual(before.body.items);
  });

  it("fails soft when catalog is down and rejects invented ids", async () => {
    const app = createApp(withAge(createMemoryStore()), {
      catalog: createDisabledTcgdexCatalogProvider(),
      pricing: createMockPricingProvider(),
    });

    const missingCatalog = await json<{
      guess: { name: string | null; estimateCents: number | null };
    }>(app, "/v1/livestream/guesses/base1-58");
    expect(missingCatalog.status).toBe(200);
    expect(missingCatalog.body.guess).toMatchObject({
      name: null,
      estimateCents: 825,
    });

    const invalid = await json<{ error: string }>(app, "/v1/livestream/guesses/not-a-card");
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe("Unknown card id");
  });

  it("recomputes display Max Buy from current prefs without persisting the reference", async () => {
    const store = createSqliteStore({ sqlitePath: ":memory:" });
    stores.push(store);
    withAge(store);
    const app = createApp(store, { pricing: createMockPricingProvider() });

    await json(app, "/v1/preferences", {
      method: "PATCH",
      body: JSON.stringify({
        targetMarginPct: 0.5,
        feesBufferPct: 0.13,
      }),
    });

    const expectedMaxBuy = computeMaxBuy({
      referencePriceAmount: "8.25",
      preferences: { targetMarginPct: 0.5, feesBufferPct: 0.13 },
    });
    const response = await json<{
      guess: { maxBuyAmount: string | null; referenceSource: string };
    }>(app, "/v1/livestream/guesses/base1-58");
    expect(response.body.guess.maxBuyAmount).toBe(expectedMaxBuy.maxBuyAmount);
    expect(response.body.guess.referenceSource).toBe(PRICE_ESTIMATE_REFERENCE_SOURCE);

    const inventory = await json<{ items: unknown[] }>(app, "/v1/inventory");
    expect(inventory.body.items).toEqual([]);
  });

  it("identifies from a live_video frame and rejects screenshots", async () => {
    const app = createApp(withAge(createMemoryStore()));
    const identified = await json<{
      identity: { tcgdexId: string | null; reason: string; pipeline: string };
    }>(app, "/v1/livestream/identify", {
      method: "POST",
      body: JSON.stringify({
        source: "live_video",
        platform: "ios",
        cardDetected: true,
        classifiedTcgdexId: "base1-58",
      }),
    });
    expect(identified.status).toBe(200);
    expect(identified.body.identity).toMatchObject({
      tcgdexId: "base1-58",
      reason: "identified",
      pipeline: "yolo_identity",
    });

    const screenshot = await json<{ error: string }>(app, "/v1/livestream/identify", {
      method: "POST",
      body: JSON.stringify({
        source: "live_video",
        screenshot: "data:image/jpeg;base64,xx",
        classifiedTcgdexId: "base1-58",
      }),
    });
    expect(screenshot.status).toBe(400);
    expect(screenshot.body.error).toBe("live_video frames only");
  });

  it("classifies a live_video identityHash against the English index and does not write inventory", async () => {
    const hash = rgbPerceptualHash(ciStillBitmap("base1-58"));
    const app = createApp(withAge(createMemoryStore()), { livestreamIdentityIndex: ciPhashIndex() });
    const before = await json<{ items: unknown[] }>(app, "/v1/inventory");

    const identified = await json<{
      identity: { tcgdexId: string | null; reason: string; pipeline: string };
    }>(app, "/v1/livestream/identify", {
      method: "POST",
      body: JSON.stringify({
        source: "live_video",
        platform: "android",
        cardDetected: true,
        identityHash: hash,
      }),
    });
    expect(identified.status).toBe(200);
    expect(identified.body.identity).toMatchObject({
      tcgdexId: "base1-58",
      reason: "identified",
      pipeline: "yolo_identity",
    });

    const after = await json<{ items: unknown[] }>(app, "/v1/inventory");
    expect(after.body.items).toEqual(before.body.items);
    expect(after.body.items).toEqual([]);

    const missingIndex = await json<{
      identity: { tcgdexId: string | null; reason: string };
    }>(createApp(withAge(createMemoryStore())), "/v1/livestream/identify", {
      method: "POST",
      body: JSON.stringify({
        source: "live_video",
        platform: "ios",
        cardDetected: true,
        identityHash: hash,
      }),
    });
    expect(missingIndex.body.identity).toMatchObject({
      tcgdexId: null,
      reason: "unidentified",
    });

    const off = await json<{
      identity: { tcgdexId: string | null; reason: string };
    }>(
      createApp(withAge(createMemoryStore()), {
        livestreamIdentify: "off",
        livestreamIdentityIndex: ciPhashIndex(),
      }),
      "/v1/livestream/identify",
      {
        method: "POST",
        body: JSON.stringify({
          source: "live_video",
          platform: "ios",
          cardDetected: true,
          identityHash: hash,
        }),
      },
    );
    expect(off.body.identity).toMatchObject({
      tcgdexId: null,
      reason: "unidentified",
    });
  });

  it("prefers OpenCLIP crop match over pHash and never writes inventory", async () => {
    const hash = rgbPerceptualHash(ciStillBitmap("base1-58"));
    const openclip = {
      name: "openclip_hnsw" as const,
      matchCropJpeg: async () => ({
        pipeline: "openclip_hnsw" as const,
        accepted: true,
        tcgdexId: "swsh3-136",
        similarity: 0.93,
      }),
    };
    const tinyJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9, ...Array(40).fill(9)]).toString("base64");
    const identified = await json<{
      identity: { tcgdexId: string | null; reason: string };
    }>(
      createApp(withAge(createMemoryStore()), {
        livestreamIdentityIndex: ciPhashIndex(),
        liveIdentityOpenclip: openclip,
      }),
      "/v1/livestream/identify",
      {
        method: "POST",
        body: JSON.stringify({
          source: "live_video",
          platform: "ios",
          cardDetected: true,
          identityHash: hash,
          identityCropJpeg: tinyJpeg,
        }),
      },
    );
    expect(identified.status).toBe(200);
    expect(identified.body.identity).toMatchObject({
      tcgdexId: "swsh3-136",
      reason: "identified",
    });

    const sidecarDown = await json<{
      identity: { tcgdexId: string | null; reason: string };
    }>(
      createApp(withAge(createMemoryStore()), {
        livestreamIdentityIndex: ciPhashIndex(),
        liveIdentityOpenclip: {
          name: "openclip_hnsw",
          async matchCropJpeg() {
            return null;
          },
        },
      }),
      "/v1/livestream/identify",
      {
        method: "POST",
        body: JSON.stringify({
          source: "live_video",
          platform: "ios",
          cardDetected: true,
          identityHash: hash,
          identityCropJpeg: tinyJpeg,
        }),
      },
    );
    expect(sidecarDown.status).toBe(200);
    expect(sidecarDown.body.identity).toMatchObject({
      tcgdexId: "base1-58",
      reason: "identified",
    });
  });

  it("uses YOLO on a live-video frame when the AGPL weights are loaded", async () => {
    const width = 40;
    const height = 56;
    const rgba = Buffer.alloc(width * height * 4, 180);
    const videoFrameJpeg = jpeg.encode({ data: rgba, width, height }, 80).data.toString("base64");
    const yolo = {
      async detect() {
        return [
          { cx: 20, cy: 28, width: 24, height: 36, angle: 0, score: 0.91 },
        ];
      },
    };
    const identified = await json<{
      identity: { tcgdexId: string | null; reason: string };
    }>(
      createApp(withAge(createMemoryStore()), {
        liveVideoObb: () => yolo,
        liveIdentityOpenclip: {
          name: "openclip_hnsw",
          async matchCropJpeg() {
            return {
              pipeline: "openclip_hnsw" as const,
              accepted: true,
              tcgdexId: "base1-4",
              similarity: 0.9,
            };
          },
        },
      }),
      "/v1/livestream/identify",
      {
        method: "POST",
        body: JSON.stringify({
          source: "live_video",
          platform: "ios",
          cardDetected: false,
          classifiedTcgdexId: "base1-58",
          videoFrameJpeg,
        }),
      },
    );
    expect(identified.status).toBe(200);
    expect(identified.body.identity).toMatchObject({
      tcgdexId: "base1-4",
      reason: "identified",
    });

    const missed = await json<{
      identity: { tcgdexId: string | null; reason: string };
    }>(
      createApp(withAge(createMemoryStore()), {
        liveVideoObb: () => ({
          async detect() {
            return [];
          },
        }),
      }),
      "/v1/livestream/identify",
      {
        method: "POST",
        body: JSON.stringify({
          source: "live_video",
          platform: "ios",
          cardDetected: true,
          classifiedTcgdexId: "base1-58",
          videoFrameJpeg,
        }),
      },
    );
    expect(missed.body.identity).toMatchObject({
      tcgdexId: null,
      reason: "no_card",
    });
  });
});
