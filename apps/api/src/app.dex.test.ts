import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createMemoryStore } from "./store";

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

async function confirmedScan(app: App, captureMethod: string, tcgdexId: string): Promise<string> {
  const scan = await json<{ scan: { scanId: string } }>(app, "/v1/scans", {
    method: "POST",
    body: JSON.stringify({ captureMethod, scenario: "high-confidence" }),
  });
  const confirmed = await json<{ confirmation: { confirmationId: string } }>(app, `/v1/scans/${scan.body.scan.scanId}/confirm`, {
    method: "POST",
    body: JSON.stringify({ tcgdexId }),
  });
  return confirmed.body.confirmation.confirmationId;
}

async function ownedIn(app: App, setId: string): Promise<string[]> {
  const view = await json<{ set: { cards: Array<{ tcgdexId: string; owned: boolean }> } }>(app, `/v1/dex/sets/${setId}`);
  return view.body.set.cards.filter((card) => card.owned).map((card) => card.tcgdexId);
}

describe("MyDEX set view", () => {
  it("lists every card in a set from catalog art, owned in color after a confirmed scan", async () => {
    const app = createApp(createMemoryStore());
    const before = await json<{ set: { owned: number; total: number; cards: Array<{ tcgdexId: string; owned: boolean; thumbUrl: string | null }> } }>(app, "/v1/dex/sets/base1");
    expect(before.status).toBe(200);
    expect(before.body.set.owned).toBe(0);
    expect(before.body.set.total).toBeGreaterThan(0);
    expect(before.body.set.cards.every((card) => !card.owned)).toBe(true);
    const pikachu = before.body.set.cards.find((card) => card.tcgdexId === "base1-58");
    expect(pikachu?.thumbUrl).toMatch(/^https:\/\/assets\.tcgdex\.net\/.*\/low\.webp$/);

    const scan = await json<{ scan: { scanId: string } }>(app, "/v1/scans", {
      method: "POST",
      body: JSON.stringify({ captureMethod: "camera_photo", scenario: "high-confidence" }),
    });
    expect(scan.status).toBe(201);
    const confirmed = await app.request(`/v1/scans/${scan.body.scan.scanId}/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tcgdexId: "base1-58" }),
    });
    expect(confirmed.status).toBe(200);

    const after = await json<{ set: { owned: number; cards: Array<{ tcgdexId: string; owned: boolean }> } }>(app, "/v1/dex/sets/base1");
    expect(after.body.set.owned).toBe(1);
    expect(after.body.set.cards.find((card) => card.tcgdexId === "base1-58")?.owned).toBe(true);

    const sets = await json<{ sets: Array<{ setId: string; owned: number; total: number }> }>(app, "/v1/dex/sets");
    expect(sets.status).toBe(200);
    expect(sets.body.sets.find((set) => set.setId === "base1")).toMatchObject({ owned: 1, total: 102 });
  });

  it("404s an unknown or malformed set", async () => {
    const app = createApp(createMemoryStore());
    expect((await app.request("/v1/dex/sets/nope-set")).status).toBe(404);
    expect((await app.request("/v1/dex/sets/bad%20id!")).status).toBe(404);
  });
});

// The memory store is shared module state, so these steps run in order after the set view test
// (which already owns base1-58 through a camera Scan a Card confirmation).
describe("MyDEX ownership sources", () => {
  it("only Scan a Card confirmations and livestream HUD Purchased taps mark owned", async () => {
    const app = createApp(createMemoryStore());
    expect(await ownedIn(app, "base1")).toEqual(["base1-58"]);

    // Watchlist and a manual (non-livestream) Purchased save never mark owned.
    const watchId = await confirmedScan(app, "livestream_hud", "base1-4");
    const w = await app.request("/v1/inventory/watchlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmationId: watchId }),
    });
    expect(w.status).toBeLessThan(300);
    const buyId = await confirmedScan(app, "livestream_hud", "base1-4");
    const p = await app.request("/v1/inventory/purchased", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmationId: buyId, purchasePrice: "5.00", purchasedAt: "2026-10-01T12:00:00.000Z" }),
    });
    expect(p.status).toBeLessThan(300);
    expect(await ownedIn(app, "base1")).toEqual(["base1-58"]);

    // Livestream HUD Purchased tap marks owned; undo clears it.
    const hudId = await confirmedScan(app, "livestream_hud", "base1-4");
    const saved = await json<{ item: { inventoryItemId: string } }>(app, "/v1/inventory/purchased", {
      method: "POST",
      body: JSON.stringify({ confirmationId: hudId, detailsNeeded: true, platform: "whatnot" }),
    });
    expect(saved.status).toBeLessThan(300);
    expect((await ownedIn(app, "base1")).sort()).toEqual(["base1-4", "base1-58"]);
    const undo = await app.request(`/v1/inventory/${saved.body.item.inventoryItemId}`, { method: "DELETE" });
    expect(undo.status).toBeLessThan(300);
    expect(await ownedIn(app, "base1")).toEqual(["base1-58"]);

    // A photo-library Scan a Card confirmation (manual_scan) counts.
    await confirmedScan(app, "manual_scan", "base1-4");
    expect((await ownedIn(app, "base1")).sort()).toEqual(["base1-4", "base1-58"]);
  });
});
