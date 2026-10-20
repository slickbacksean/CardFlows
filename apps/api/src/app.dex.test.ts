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
