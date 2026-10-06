import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  INVITED_USERS,
  createMockPricingProvider,
  pokecollectorUsernameForIdentity,
} from "@cardflow/shared";
import { createApp } from "./app";
import { ALEX_INVITE_CODE, JORDAN_INVITE_CODE } from "./invited-testers";
import {
  createMockPokecollectorAccounts,
  createPokecollectorAccounts,
  englishPokecollectorCardId,
  type PokecollectorAccounts,
  type PokecollectorCollectionCopy,
} from "./pokecollector-accounts";
import { createSqliteStore, type SqliteStorePort } from "./sqlite-store";

type App = ReturnType<typeof createApp>;

const srcDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(srcDir, "../../..");

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

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function seededCopy(tcgdexId: string): PokecollectorCollectionCopy {
  return {
    id: tcgdexId,
    tcgdexId,
    quantity: 1,
    selectedVariant: null,
    condition: null,
    purchasePrice: null,
  };
}

function expectNoVendorSessionLeak(value: unknown) {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toMatch(/access_token|Bearer |jwt/i);
  expect(serialized).not.toContain("pokecollector-secret");
  expect(serialized).not.toContain("/api/auth");
  expect(serialized).not.toContain("/api/collection");
}

function readRequestBody(init?: RequestInit): Record<string, unknown> {
  if (!init?.body) return {};
  if (typeof init.body === "string") {
    const trimmed = init.body.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      return JSON.parse(trimmed) as Record<string, unknown>;
    }
    return Object.fromEntries(new URLSearchParams(trimmed));
  }
  if (init.body instanceof URLSearchParams) {
    return Object.fromEntries(init.body);
  }
  return {};
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function confirmCard(app: App, tcgdexId: string, headers: Record<string, string> = {}) {
  const scan = await json<{
    scan: { scanId: string; cardflowCardId: string | null; inventoryItemId: string | null };
  }>(app, "/v1/scans", {
    method: "POST",
    headers,
    body: JSON.stringify({ captureMethod: "camera_photo", scenario: "high-confidence" }),
  });
  expect(scan.status).toBe(201);
  expect(scan.body.scan.cardflowCardId).toBeNull();
  expect(scan.body.scan.inventoryItemId).toBeNull();

  const confirmed = await json<{
    confirmation: { confirmationId: string; cardflowCardId: string };
    canonicalCard: { cardflowCardId: string; tcgdexId: string };
  }>(app, `/v1/scans/${scan.body.scan.scanId}/confirm`, {
    method: "POST",
    headers,
    body: JSON.stringify({ tcgdexId }),
  });
  expect(confirmed.status).toBe(200);
  return confirmed.body;
}

describe("invite session maps to a PokéCollector user", () => {
  const stores: SqliteStorePort[] = [];

  afterEach(() => {
    for (const store of stores.splice(0)) store.close();
  });

  it("upserts a server-side mapping on redeem without a PokéCollector JWT on the client", async () => {
    const store = createSqliteStore({ sqlitePath: ":memory:" });
    stores.push(store);
    const accounts = createMockPokecollectorAccounts();
    const app = createApp(store, { pokecollectorAccounts: accounts, devAutoSession: false });
    const alex = INVITED_USERS[0];

    const session = await json<{
      token: string;
      identity: { userId: string };
      invitedUsers: unknown[];
    }>(app, "/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ inviteCode: ALEX_INVITE_CODE }),
    });
    expect(session.status).toBe(200);
    expect(session.body.identity.userId).toBe(alex.userId);
    expectNoVendorSessionLeak(session.body);

    const mapping = store.getPokecollectorUserMapping(alex.userId);
    expect(mapping).toMatchObject({
      userId: alex.userId,
      pokecollectorUsername: pokecollectorUsernameForIdentity(alex),
    });
    expect(mapping?.pokecollectorUserId).toBeTruthy();
    expect(JSON.stringify(mapping)).not.toMatch(/access_token|password|jwt/i);
  });

  it("keeps Alex and Jordan PokéCollector collections isolated", async () => {
    const store = createSqliteStore({ sqlitePath: ":memory:" });
    stores.push(store);
    const accounts = createMockPokecollectorAccounts();
    const app = createApp(store, { pokecollectorAccounts: accounts, devAutoSession: false });

    const alexSession = await json<{ token: string }>(app, "/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ inviteCode: ALEX_INVITE_CODE }),
    });
    const jordanSession = await json<{ token: string }>(app, "/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ inviteCode: JORDAN_INVITE_CODE }),
    });

    const alexMap = store.getPokecollectorUserMapping(INVITED_USERS[0].userId);
    const jordanMap = store.getPokecollectorUserMapping(INVITED_USERS[1].userId);
    expect(alexMap?.pokecollectorUserId).toBeTruthy();
    expect(jordanMap?.pokecollectorUserId).toBeTruthy();
    expect(alexMap?.pokecollectorUserId).not.toBe(jordanMap?.pokecollectorUserId);

    accounts.seedCollection(alexMap!.pokecollectorUserId, [seededCopy("base1-58")]);
    accounts.seedCollection(jordanMap!.pokecollectorUserId, [seededCopy("swsh3-136")]);

    const alexCollection = await json<{ items: Array<{ tcgdexId: string | null }> }>(
      app,
      `/v1/collection?pokecollectorUserId=${jordanMap!.pokecollectorUserId}`,
      { headers: bearer(alexSession.body.token) },
    );
    const jordanCollection = await json<{ items: Array<{ tcgdexId: string | null }> }>(
      app,
      "/v1/collection",
      { headers: bearer(jordanSession.body.token) },
    );

    expect(alexCollection.status).toBe(200);
    expect(alexCollection.body.items).toEqual([{ tcgdexId: "base1-58" }]);
    expect(jordanCollection.body.items).toEqual([{ tcgdexId: "swsh3-136" }]);
    expect(JSON.stringify(alexCollection.body)).not.toContain("swsh3-136");
    expect(JSON.stringify(jordanCollection.body)).not.toContain("base1-58");
    expectNoVendorSessionLeak(alexCollection.body);
    expectNoVendorSessionLeak(jordanCollection.body);
  });

  it("HTTP upsert uses admin users API and collection reads only the mapped user", async () => {
    const users: Array<{ id: number; username: string }> = [];
    const collections: Record<string, Array<{ card_id: string }>> = {
      "cardflow-alex": [{ card_id: "base1-58_en" }],
      "cardflow-jordan": [{ card_id: "swsh3-136_en" }],
    };
    const urls: string[] = [];
    const collectionAuths: string[] = [];
    const accounts = createPokecollectorAccounts({
      baseUrl: "http://127.0.0.1:8000",
      token: "pokecollector-secret",
      sleep: async () => undefined,
      fetchImpl: async (input, init) => {
        const url = requestUrl(input);
        urls.push(url);
        const authorization = new Headers(init?.headers).get("authorization");
        if (url.includes("/api/auth/users")) {
          expect(authorization).toBe("Bearer pokecollector-secret");
        }
        if (url.endsWith("/api/auth/users") && (init?.method ?? "GET") === "GET") {
          return new Response(JSON.stringify(users), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.endsWith("/api/auth/users") && init?.method === "POST") {
          const body = JSON.parse(String(init.body)) as { username: string; password: string };
          expect(body.password).toBeTruthy();
          const created = { id: users.length + 11, username: body.username };
          users.push(created);
          return new Response(JSON.stringify(created), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.endsWith("/api/auth/login") && init?.method === "POST") {
          expect(authorization).toBeNull();
          const params = new URLSearchParams(String(init.body));
          const username = params.get("username") ?? "";
          return new Response(JSON.stringify({ access_token: `pc-jwt-${username}` }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.endsWith("/api/collection/") || url.endsWith("/api/collection")) {
          collectionAuths.push(authorization ?? "");
          const username = authorization?.replace(/^Bearer pc-jwt-/, "") ?? "";
          return new Response(JSON.stringify(collections[username] ?? []), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ error: "missing" }), { status: 404 });
      },
    });

    const store = createSqliteStore({ sqlitePath: ":memory:" });
    stores.push(store);
    const app = createApp(store, { pokecollectorAccounts: accounts, devAutoSession: false });

    const alexSession = await json<{ token: string }>(app, "/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ inviteCode: ALEX_INVITE_CODE }),
    });
    const jordanSession = await json<{ token: string }>(app, "/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ inviteCode: JORDAN_INVITE_CODE }),
    });
    expectNoVendorSessionLeak(alexSession.body);
    expectNoVendorSessionLeak(jordanSession.body);

    expect(store.getPokecollectorUserMapping(INVITED_USERS[0].userId)?.pokecollectorUserId).toBe(
      "11",
    );
    expect(store.getPokecollectorUserMapping(INVITED_USERS[1].userId)?.pokecollectorUserId).toBe(
      "12",
    );

    urls.length = 0;
    const alexCollection = await json<{ items: Array<{ tcgdexId: string | null }> }>(
      app,
      "/v1/collection",
      { headers: bearer(alexSession.body.token) },
    );
    const jordanCollection = await json<{ items: Array<{ tcgdexId: string | null }> }>(
      app,
      "/v1/collection",
      { headers: bearer(jordanSession.body.token) },
    );

    expect(alexCollection.body.items).toEqual([{ tcgdexId: "base1-58" }]);
    expect(jordanCollection.body.items).toEqual([{ tcgdexId: "swsh3-136" }]);
    expectNoVendorSessionLeak(alexCollection.body);
    expectNoVendorSessionLeak(jordanCollection.body);
    expect(collectionAuths).toEqual([
      "Bearer pc-jwt-cardflow-alex",
      "Bearer pc-jwt-cardflow-jordan",
    ]);
    expect(urls.some((url) => url.endsWith("/api/auth/login"))).toBe(true);
    expect(urls.some((url) => url.includes("/api/collection"))).toBe(true);
    expect(urls.some((url) => url.includes("/api/collection/user/"))).toBe(false);
    expect(JSON.stringify(alexCollection.body)).not.toContain("swsh3-136");
    expect(JSON.stringify(jordanCollection.body)).not.toContain("base1-58");
  });

  it("still redeems an invite when PokéCollector is off or unreachable", async () => {
    const store = createSqliteStore({ sqlitePath: ":memory:" });
    stores.push(store);
    const app = createApp(store, { devAutoSession: false });
    const session = await json<{ token: string; identity: { userId: string } }>(app, "/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ inviteCode: ALEX_INVITE_CODE }),
    });
    expect(session.status).toBe(200);
    expect(session.body.identity.userId).toBe(INVITED_USERS[0].userId);
    expect(store.getPokecollectorUserMapping(INVITED_USERS[0].userId)).toBeUndefined();

    const collection = await json<{ items: unknown[] }>(app, "/v1/collection", {
      headers: bearer(session.body.token),
    });
    expect(collection.status).toBe(200);
    expect(collection.body.items).toEqual([]);
  });

  it("keeps PokéCollector JWTs out of SecureStore and overlay still clears on switch", () => {
    const sessionToken = readFileSync(path.join(repoRoot, "apps/mobile/lib/session-token.ts"), "utf8");
    const identity = readFileSync(path.join(repoRoot, "apps/mobile/lib/identity.ts"), "utf8");
    const apiClient = readFileSync(path.join(repoRoot, "apps/mobile/lib/api.ts"), "utf8");
    expect(sessionToken).toContain("cardflow.session.token");
    expect(sessionToken).toContain("SecureStore.setItemAsync(SESSION_TOKEN_KEY, token)");
    expect(sessionToken).not.toMatch(/pokecollector|access_token|jwt/i);
    expect(identity).toContain("persistSessionToken(result.token)");
    expect(identity).toContain("clearLivestreamOverlay()");
    expect(identity).not.toMatch(/pokecollector|access_token/i);
    expect(apiClient).not.toMatch(/\/api\/auth\/login|\/api\/collection\/user/i);
  });
});

describe("collection and portfolio read PokéCollector", () => {
  const stores: SqliteStorePort[] = [];

  afterEach(() => {
    for (const store of stores.splice(0)) store.close();
  });

  it("stamps English PokéCollector card ids without duplicating the language suffix", () => {
    expect(englishPokecollectorCardId("base1-58")).toBe("base1-58_en");
    expect(englishPokecollectorCardId("base1-58_en")).toBe("base1-58_en");
  });

  it("does not write collection or wishlist on Confirm", async () => {
    const store = createSqliteStore({ sqlitePath: ":memory:" });
    stores.push(store);
    const accounts = createMockPokecollectorAccounts();
    const app = createApp(store, { pokecollectorAccounts: accounts, devAutoSession: false });
    const session = await json<{ token: string }>(app, "/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ inviteCode: ALEX_INVITE_CODE }),
    });
    const headers = bearer(session.body.token);

    await confirmCard(app, "base1-58", headers);

    const collection = await json<{ items: unknown[] }>(app, "/v1/collection", { headers });
    const inventory = await json<{ items: unknown[] }>(app, "/v1/inventory", { headers });
    const mapping = store.getPokecollectorUserMapping(INVITED_USERS[0].userId);
    expect(collection.body.items).toEqual([]);
    expect(inventory.body.items).toEqual([]);
    expect(await accounts.listCollection(mapping!)).toEqual([]);
    expect(await accounts.listWishlist(mapping!)).toEqual([]);
  });

  it("Purchased writes collection, Watchlist writes wishlist, and inventory tiles follow PokéCollector", async () => {
    const store = createSqliteStore({ sqlitePath: ":memory:" });
    stores.push(store);
    const accounts = createMockPokecollectorAccounts();
    const app = createApp(store, {
      pokecollectorAccounts: accounts,
      pricing: createMockPricingProvider(),
      devAutoSession: false,
    });
    const session = await json<{ token: string }>(app, "/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ inviteCode: ALEX_INVITE_CODE }),
    });
    const headers = bearer(session.body.token);
    const purchasedConfirm = await confirmCard(app, "base1-58", headers);
    const watchConfirm = await confirmCard(app, "base1-4", headers);

    const purchased = await json<{ item: { inventoryItemId: string; intent: string } }>(
      app,
      "/v1/inventory/purchased",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          confirmationId: purchasedConfirm.confirmation.confirmationId,
          purchasePrice: "10.50",
          purchasedAt: "2026-09-16",
          condition: "NM",
        }),
      },
    );
    expect(purchased.status).toBe(201);

    const watching = await json<{ item: { inventoryItemId: string; intent: string } }>(
      app,
      "/v1/inventory/watchlist",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          confirmationId: watchConfirm.confirmation.confirmationId,
        }),
      },
    );
    expect(watching.status).toBe(201);

    const mapping = store.getPokecollectorUserMapping(INVITED_USERS[0].userId)!;
    expect((await accounts.listCollection(mapping)).map((row) => row.tcgdexId)).toEqual([
      "base1-58",
    ]);
    expect((await accounts.listWishlist(mapping)).map((row) => row.tcgdexId)).toEqual(["base1-4"]);

    const collection = await json<{ items: Array<{ tcgdexId: string }> }>(app, "/v1/collection", {
      headers,
    });
    expect(collection.body.items).toEqual([{ tcgdexId: "base1-58" }]);

    const inventory = await json<{
      items: Array<{ inventoryItemId: string; intent: string; card: { tcgdexId: string } | null }>;
    }>(app, "/v1/inventory", { headers });
    expect(inventory.body.items.map((item) => item.intent).sort()).toEqual([
      "purchased",
      "watchlist",
    ]);
    expect(
      inventory.body.items.find((item) => item.intent === "purchased")?.inventoryItemId,
    ).toBe(purchased.body.item.inventoryItemId);
    expect(inventory.body.items.find((item) => item.intent === "purchased")?.card?.tcgdexId).toBe(
      "base1-58",
    );
    expect(inventory.body.items.find((item) => item.intent === "watchlist")?.card?.tcgdexId).toBe(
      "base1-4",
    );

    accounts.seedCollection(mapping.pokecollectorUserId, []);
    const afterWipe = await json<{ items: Array<{ intent: string }> }>(app, "/v1/inventory", {
      headers,
    });
    expect(store.listInventory(INVITED_USERS[0].userId)).toHaveLength(2);
    expect(afterWipe.body.items.map((item) => item.intent)).toEqual(["watchlist"]);
  });

  it("portfolio is a USD estimate and never profit", async () => {
    const store = createSqliteStore({ sqlitePath: ":memory:" });
    stores.push(store);
    const accounts = createMockPokecollectorAccounts();
    const app = createApp(store, {
      pokecollectorAccounts: accounts,
      pricing: createMockPricingProvider(),
      devAutoSession: false,
    });
    const session = await json<{ token: string }>(app, "/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ inviteCode: ALEX_INVITE_CODE }),
    });
    const headers = bearer(session.body.token);
    const confirmed = await confirmCard(app, "base1-58", headers);
    await json(app, "/v1/inventory/purchased", {
      method: "POST",
      headers,
      body: JSON.stringify({
        confirmationId: confirmed.confirmation.confirmationId,
        purchasePrice: "10.50",
        purchasedAt: "2026-09-16",
      }),
    });

    const portfolio = await json<{
      currency: string;
      portfolio: {
        amountCents: number | null;
        display: string;
        label: string;
      };
    }>(app, "/v1/portfolio", { headers });
    expect(portfolio.status).toBe(200);
    expect(portfolio.body.currency).toBe("USD");
    expect(portfolio.body.portfolio).toMatchObject({
      amountCents: 825,
      display: "Estimate $8.25",
      label: "estimate",
      notAMarket: true,
      notABid: true,
    });
    expect(JSON.stringify(portfolio.body).toLowerCase()).not.toContain("profit");
    expectNoVendorSessionLeak(portfolio.body);
  });

  it("records one real portfolio snapshot per day and serves the history", async () => {
    const store = createSqliteStore({ sqlitePath: ":memory:" });
    stores.push(store);
    let clock = new Date(2026, 9, 1, 9, 0, 0);
    const app = createApp(store, {
      pokecollectorAccounts: createMockPokecollectorAccounts(),
      pricing: createMockPricingProvider(),
      devAutoSession: false,
      now: () => clock,
    });
    const session = await json<{ token: string }>(app, "/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ inviteCode: ALEX_INVITE_CODE }),
    });
    const headers = bearer(session.body.token);

    type History = {
      ok: boolean;
      range: string;
      today: string;
      points: Array<{ date: string; amountCents: number; amount: string }>;
    };
    const empty = await json<History>(app, "/v1/portfolio/history", { headers });
    expect(empty.status).toBe(200);
    expect(empty.body.points).toEqual([]);

    // No estimate yet: nothing is recorded.
    await json(app, "/v1/portfolio", { headers });
    expect((await json<History>(app, "/v1/portfolio/history", { headers })).body.points).toEqual(
      [],
    );

    const confirmed = await confirmCard(app, "base1-58", headers);
    await json(app, "/v1/inventory/purchased", {
      method: "POST",
      headers,
      body: JSON.stringify({
        confirmationId: confirmed.confirmation.confirmationId,
        purchasePrice: "10.50",
        purchasedAt: "2026-09-16",
      }),
    });
    await json(app, "/v1/portfolio", { headers });
    clock = new Date(2026, 9, 1, 18, 0, 0);
    await json(app, "/v1/portfolio", { headers });
    const sameDay = await json<History>(app, "/v1/portfolio/history", { headers });
    expect(sameDay.body.points).toHaveLength(1);
    expect(sameDay.body.points[0]).toMatchObject({
      date: "2026-10-01",
      amountCents: 825,
      amount: "8.25",
    });

    clock = new Date(2026, 9, 12, 8, 0, 0);
    await json(app, "/v1/portfolio", { headers });
    const all = await json<History>(app, "/v1/portfolio/history?range=all", { headers });
    expect(all.body.points.map((point) => point.date)).toEqual(["2026-10-01", "2026-10-12"]);
    expect(all.body.today).toBe("2026-10-12");
    const week = await json<History>(app, "/v1/portfolio/history?range=7d", { headers });
    expect(week.body.points.map((point) => point.date)).toEqual(["2026-10-12"]);
    expect((await json(app, "/v1/portfolio/history?range=1y", { headers })).status).toBe(400);
    expectNoVendorSessionLeak(all.body);
  });

  it("does not save SQLite inventory when the PokéCollector write fails", async () => {
    const store = createSqliteStore({ sqlitePath: ":memory:" });
    stores.push(store);
    const accounts = createMockPokecollectorAccounts();
    const failing = {
      ...accounts,
      async addPurchased() {
        return null;
      },
    };
    const app = createApp(store, { pokecollectorAccounts: failing, devAutoSession: false });
    const session = await json<{ token: string }>(app, "/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ inviteCode: ALEX_INVITE_CODE }),
    });
    const headers = bearer(session.body.token);
    const confirmed = await confirmCard(app, "base1-58", headers);

    const purchased = await json<{ error: string }>(app, "/v1/inventory/purchased", {
      method: "POST",
      headers,
      body: JSON.stringify({
        confirmationId: confirmed.confirmation.confirmationId,
        purchasePrice: "10.50",
        purchasedAt: "2026-09-16",
      }),
    });
    expect(purchased.status).toBe(503);
    expect(purchased.body.error).toMatch(/temporarily unavailable/i);
    expect(store.listInventory(INVITED_USERS[0].userId)).toEqual([]);
  });

  it("returns the existing copy when the same confirmation is confirmed or purchased again", async () => {
    const store = createSqliteStore({ sqlitePath: ":memory:" });
    stores.push(store);
    const accounts = createMockPokecollectorAccounts();
    let purchasedWrites = 0;
    let watchlistWrites = 0;
    const counting = {
      ...accounts,
      async addPurchased(
        ...args: Parameters<PokecollectorAccounts["addPurchased"]>
      ) {
        purchasedWrites += 1;
        return accounts.addPurchased(...args);
      },
      async addWatchlist(
        ...args: Parameters<PokecollectorAccounts["addWatchlist"]>
      ) {
        watchlistWrites += 1;
        return accounts.addWatchlist(...args);
      },
    };
    const app = createApp(store, { pokecollectorAccounts: counting, devAutoSession: false });
    const session = await json<{ token: string }>(app, "/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ inviteCode: ALEX_INVITE_CODE }),
    });
    const headers = bearer(session.body.token);
    const scan = await json<{ scan: { scanId: string } }>(app, "/v1/scans", {
      method: "POST",
      headers,
      body: JSON.stringify({ captureMethod: "camera_photo", scenario: "high-confidence" }),
    });
    const firstConfirm = await json<{
      confirmation: { confirmationId: string };
    }>(app, `/v1/scans/${scan.body.scan.scanId}/confirm`, {
      method: "POST",
      headers,
      body: JSON.stringify({ tcgdexId: "base1-58" }),
    });
    const secondConfirm = await json<{
      confirmation: { confirmationId: string };
    }>(app, `/v1/scans/${scan.body.scan.scanId}/confirm`, {
      method: "POST",
      headers,
      body: JSON.stringify({ tcgdexId: "base1-4" }),
    });
    expect(secondConfirm.status).toBe(200);
    expect(secondConfirm.body.confirmation.confirmationId).toBe(
      firstConfirm.body.confirmation.confirmationId,
    );

    const purchaseBody = {
      confirmationId: firstConfirm.body.confirmation.confirmationId,
      purchasePrice: "10.50",
      purchasedAt: "2026-09-16",
    };
    const first = await json<{ item: { inventoryItemId: string } }>(
      app,
      "/v1/inventory/purchased",
      { method: "POST", headers, body: JSON.stringify(purchaseBody) },
    );
    const second = await json<{ created: boolean; item: { inventoryItemId: string } }>(
      app,
      "/v1/inventory/purchased",
      { method: "POST", headers, body: JSON.stringify(purchaseBody) },
    );
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.created).toBe(false);
    expect(second.body.item.inventoryItemId).toBe(first.body.item.inventoryItemId);
    expect(purchasedWrites).toBe(1);
    expect(store.listInventory(INVITED_USERS[0].userId)).toHaveLength(1);

    const badPrice = await json<{ error: string }>(app, "/v1/inventory/purchased", {
      method: "POST",
      headers,
      body: JSON.stringify({
        confirmationId: firstConfirm.body.confirmation.confirmationId,
        purchasePrice: "abc",
        purchasedAt: "2026-09-16",
        anotherCopy: true,
      }),
    });
    expect(badPrice.status).toBe(400);
    expect(purchasedWrites).toBe(1);
    expect(store.listInventory(INVITED_USERS[0].userId)).toHaveLength(1);

    const watchBody = {
      confirmationId: firstConfirm.body.confirmation.confirmationId,
      referencePriceAmount: "20.00",
    };
    const firstWatch = await json<{ item: { inventoryItemId: string } }>(
      app,
      "/v1/inventory/watchlist",
      { method: "POST", headers, body: JSON.stringify(watchBody) },
    );
    const secondWatch = await json<{ created: boolean; item: { inventoryItemId: string } }>(
      app,
      "/v1/inventory/watchlist",
      {
        method: "POST",
        headers: { ...headers, "Idempotency-Key": "watch-1" },
        body: JSON.stringify(watchBody),
      },
    );
    expect(firstWatch.status).toBe(201);
    expect(secondWatch.status).toBe(200);
    expect(secondWatch.body.item.inventoryItemId).toBe(firstWatch.body.item.inventoryItemId);
    expect(watchlistWrites).toBe(1);

    const badWatch = await json(app, "/v1/inventory/watchlist", {
      method: "POST",
      headers,
      body: JSON.stringify({
        confirmationId: firstConfirm.body.confirmation.confirmationId,
        referencePriceAmount: "nope",
        anotherCopy: true,
      }),
    });
    expect(badWatch.status).toBe(400);
    expect(watchlistWrites).toBe(1);
  });

  it("keeps Draft Copy omitting notes when PokéCollector is inventory SoR", async () => {
    const store = createSqliteStore({ sqlitePath: ":memory:" });
    stores.push(store);
    const accounts = createMockPokecollectorAccounts();
    const app = createApp(store, { pokecollectorAccounts: accounts, devAutoSession: false });
    const session = await json<{ token: string }>(app, "/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ inviteCode: ALEX_INVITE_CODE }),
    });
    const headers = bearer(session.body.token);
    const confirmed = await confirmCard(app, "base1-58", headers);
    const purchased = await json<{ item: { inventoryItemId: string } }>(
      app,
      "/v1/inventory/purchased",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          confirmationId: confirmed.confirmation.confirmationId,
          purchasePrice: "10.50",
          purchasedAt: "2026-09-16",
        }),
      },
    );
    const draft = await json<{ draft: { draftId: string } }>(
      app,
      `/v1/inventory/${purchased.body.item.inventoryItemId}/drafts`,
      { method: "POST", headers },
    );
    await json(app, `/v1/drafts/${draft.body.draft.draftId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        askingPrice: "15.00",
        notes: "Private: all-in was $11.75. Maybe list on eBay later.",
      }),
    });
    const copy = await json<{
      clipboard: { omittedPrivateNotes: boolean; plainText: string; published: boolean };
    }>(app, `/v1/drafts/${draft.body.draft.draftId}/clipboard`, { headers });
    expect(copy.body.clipboard.omittedPrivateNotes).toBe(true);
    expect(copy.body.clipboard.published).toBe(false);
    expect(copy.body.clipboard.plainText).toContain("15.00");
    expect(copy.body.clipboard.plainText).not.toContain("Private");
    expect(copy.body.clipboard.plainText).not.toContain("eBay");
  });

  it("HTTP Purchased posts collection and Watchlist posts wishlist as the mapped user", async () => {
    const users: Array<{ id: number; username: string }> = [];
    const collections = new Map<string, Array<Record<string, unknown>>>();
    const wishlists = new Map<string, Array<Record<string, unknown>>>();
    const usernameByToken = new Map<string, string>();
    const posted: Array<{ path: string; body: Record<string, unknown> }> = [];
    const accounts = createPokecollectorAccounts({
      baseUrl: "http://127.0.0.1:8000",
      token: "pokecollector-secret",
      sleep: async () => undefined,
      fetchImpl: async (input, init) => {
        const url = requestUrl(input);
        const auth = new Headers(init?.headers).get("authorization");
        const method = (init?.method ?? "GET").toUpperCase();
        if (url.endsWith("/api/auth/users") && method === "GET") return jsonResponse(users);
        if (url.endsWith("/api/auth/users") && method === "POST") {
          const body = readRequestBody(init) as { username: string; password: string };
          const created = { id: users.length + 11, username: body.username };
          users.push(created);
          collections.set(body.username, []);
          wishlists.set(body.username, []);
          return jsonResponse(created);
        }
        if (url.endsWith("/api/auth/login") && method === "POST") {
          expect(auth).toBeNull();
          const body = readRequestBody(init);
          const username = String(body.username ?? "");
          const token = `pc-jwt-${username}`;
          usernameByToken.set(token, username);
          return jsonResponse({ access_token: token });
        }
        const token = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
        const username = usernameByToken.get(token);
        if (!username) return jsonResponse({ error: "unauthorized" }, 401);
        if (url.includes("/api/collection") && method === "POST") {
          const body = readRequestBody(init);
          posted.push({ path: "/api/collection/", body });
          const row = { id: "c1", ...body };
          collections.set(username, [...(collections.get(username) ?? []), row]);
          return jsonResponse(row);
        }
        if (url.includes("/api/wishlist") && method === "POST") {
          const body = readRequestBody(init);
          posted.push({ path: "/api/wishlist/", body });
          const row = { id: "w1", ...body };
          wishlists.set(username, [...(wishlists.get(username) ?? []), row]);
          return jsonResponse(row);
        }
        if (url.includes("/api/collection") && method === "GET") {
          return jsonResponse(collections.get(username) ?? []);
        }
        if (url.includes("/api/wishlist") && method === "GET") {
          return jsonResponse(wishlists.get(username) ?? []);
        }
        return jsonResponse({ error: "missing" }, 404);
      },
    });

    const store = createSqliteStore({ sqlitePath: ":memory:" });
    stores.push(store);
    const app = createApp(store, { pokecollectorAccounts: accounts, devAutoSession: false });
    const session = await json<{ token: string }>(app, "/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ inviteCode: ALEX_INVITE_CODE }),
    });
    const headers = bearer(session.body.token);
    const purchasedConfirm = await confirmCard(app, "base1-58", headers);
    const watchConfirm = await confirmCard(app, "base1-4", headers);

    expect(
      (
        await json(app, "/v1/inventory/purchased", {
          method: "POST",
          headers,
          body: JSON.stringify({
            confirmationId: purchasedConfirm.confirmation.confirmationId,
            purchasePrice: "10.50",
            purchasedAt: "2026-09-16",
            condition: "NM",
          }),
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await json(app, "/v1/inventory/watchlist", {
          method: "POST",
          headers,
          body: JSON.stringify({
            confirmationId: watchConfirm.confirmation.confirmationId,
          }),
        })
      ).status,
    ).toBe(201);

    expect(posted).toEqual([
      {
        path: "/api/collection/",
        body: {
          card_id: "base1-58_en",
          quantity: 1,
          condition: "NM",
          variant: "Normal",
          lang: "en",
          purchase_price: 10.5,
        },
      },
      {
        path: "/api/wishlist/",
        body: {
          card_id: "base1-4_en",
          quantity: 1,
        },
      },
    ]);
  });

  it("Collection UI shows a muted estimate and never a PokéCollector JWT", () => {
    const collection = readFileSync(
      path.join(repoRoot, "apps/mobile/app/(tabs)/collection.tsx"),
      "utf8",
    );
    const apiClient = readFileSync(path.join(repoRoot, "apps/mobile/lib/api.ts"), "utf8");
    expect(collection).toContain("listInventory()");
    expect(collection).toContain("getPortfolio()");
    expect(collection).toContain("portfolio.display");
    expect(collection).toContain("colors.muted");
    expect(collection.toLowerCase()).not.toContain("profit");
    expect(collection).toContain("item.readOnly");
    expect(collection).toContain("showDraftCta={item.intent === \"purchased\" && !item.readOnly}");
    expect(apiClient).toContain('"/v1/portfolio"');
    expect(apiClient).not.toMatch(/\/api\/collection|\/api\/wishlist|access_token/i);
  });

  it("keeps a PokéCollector-only row read-only with a stable time and a catalog name", async () => {
    const store = createSqliteStore({ sqlitePath: ":memory:" });
    stores.push(store);
    const accounts = createMockPokecollectorAccounts();
    const app = createApp(store, { pokecollectorAccounts: accounts, devAutoSession: false });
    const session = await json<{ token: string }>(app, "/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ inviteCode: ALEX_INVITE_CODE }),
    });
    const headers = bearer(session.body.token);
    const mapping = await accounts.upsertInvitedUser(INVITED_USERS[0]!);
    accounts.seedCollection(mapping!.pokecollectorUserId, [seededCopy("base1-58")]);
    accounts.seedWishlist(mapping!.pokecollectorUserId, [seededCopy("base1-4")]);

    const first = await json<{
      items: Array<{
        inventoryItemId: string;
        cardflowCardId: string;
        createdAt: string;
        readOnly: boolean;
        intent: string;
        card: { name: string; tcgdexId: string } | null;
        draft: unknown;
      }>;
    }>(app, "/v1/inventory", { headers });
    expect(first.status).toBe(200);
    const purchased = first.body.items.find((item) => item.intent === "purchased");
    const watching = first.body.items.find((item) => item.intent === "watchlist");
    expect(purchased).toMatchObject({
      inventoryItemId: "pc:purchased:base1-58",
      readOnly: true,
      createdAt: "1970-01-01T00:00:00.000Z",
      draft: null,
      card: { name: "Pikachu", tcgdexId: "base1-58" },
    });
    expect(watching).toMatchObject({
      inventoryItemId: "pc:watchlist:base1-4",
      readOnly: true,
      card: { name: "Charizard", tcgdexId: "base1-4" },
    });

    const second = await json<{ items: Array<{ inventoryItemId: string; createdAt: string }> }>(
      app,
      "/v1/inventory",
      { headers },
    );
    expect(
      second.body.items.find((item) => item.inventoryItemId === "pc:purchased:base1-58")
        ?.createdAt,
    ).toBe(purchased?.createdAt);
    expect(store.listInventory(INVITED_USERS[0]!.userId)).toEqual([]);
  });
});
