import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_BUY_PREFERENCES,
  INVITED_USERS,
  recomputeCopyMaxBuy,
} from "@cardflow/shared";
import { createApp } from "./app";
import { JORDAN_INVITE_CODE } from "./invited-testers";
import { createSqliteStore, type SqliteStorePort } from "./sqlite-store";
import { createStoreFromEnv } from "./store-env";

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

async function confirmCard(app: App, tcgdexId: string) {
  const before = await json<{ items: unknown[] }>(app, "/v1/inventory");

  const scan = await json<{
    scan: { scanId: string; cardflowCardId: string | null; inventoryItemId: string | null };
  }>(app, "/v1/scans", {
    method: "POST",
    body: JSON.stringify({ captureMethod: "camera_photo", scenario: "high-confidence" }),
  });
  expect(scan.status).toBe(201);
  expect(scan.body.scan.cardflowCardId).toBeNull();
  expect(scan.body.scan.inventoryItemId).toBeNull();

  const inventoryAfterScan = await json<{ items: unknown[] }>(app, "/v1/inventory");
  expect(inventoryAfterScan.body.items).toHaveLength(before.body.items.length);

  const confirmed = await json<{
    scan: { cardflowCardId: string; confirmationId: string };
    confirmation: {
      confirmationId: string;
      cardflowCardId: string;
      mintedCardflowCardId: boolean;
    };
    canonicalCard: { cardflowCardId: string; tcgdexId: string };
  }>(app, `/v1/scans/${scan.body.scan.scanId}/confirm`, {
    method: "POST",
    body: JSON.stringify({ tcgdexId }),
  });
  expect(confirmed.status).toBe(200);
  expect(confirmed.body.scan.cardflowCardId).toBe(confirmed.body.canonicalCard.cardflowCardId);
  expect(confirmed.body.confirmation.cardflowCardId).toBe(
    confirmed.body.canonicalCard.cardflowCardId,
  );

  const inventoryAfterConfirm = await json<{ items: unknown[] }>(app, "/v1/inventory");
  expect(inventoryAfterConfirm.body.items).toHaveLength(before.body.items.length);

  return confirmed.body;
}

describe("durable SQLite routes", () => {
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

  function openFileApp() {
    const dir = mkdtempSync(path.join(tmpdir(), "cardflow-persist-"));
    tempDirs.push(dir);
    const sqlitePath = path.join(dir, "cardflow.sqlite");
    const store = createSqliteStore({ sqlitePath });
    stores.push(store);
    return { sqlitePath, store, app: createApp(store) };
  }

  function reopen(sqlitePath: string) {
    stores.pop()?.close();
    const store = createSqliteStore({ sqlitePath });
    stores.push(store);
    return { store, app: createApp(store) };
  }

  it("pnpm test stays on memory unless a test opts into SQLite", () => {
    expect(process.env.CARD_FLOW_STORE).toBe("memory");
    expect(createStoreFromEnv().selection.kind).toBe("memory");
  });

  it("scan does not create inventory; Confirm mints then reuses cardflow_card_id", async () => {
    const store = createSqliteStore({ sqlitePath: ":memory:" });
    stores.push(store);
    const app = createApp(store);

    const first = await confirmCard(app, "base1-58");
    expect(first.confirmation.mintedCardflowCardId).toBe(true);

    const second = await confirmCard(app, "base1-58");
    expect(second.confirmation.mintedCardflowCardId).toBe(false);
    expect(second.canonicalCard.cardflowCardId).toBe(first.canonicalCard.cardflowCardId);

    const card = await json<{ canonicalCard: { tcgdexId: string } }>(
      app,
      `/v1/cards/${first.canonicalCard.cardflowCardId}`,
    );
    expect(card.body.canonicalCard.tcgdexId).toBe("base1-58");
  });

  it("switching testers filters rows and does not mint inventory", async () => {
    const store = createSqliteStore({ sqlitePath: ":memory:" });
    stores.push(store);
    const app = createApp(store);
    const jordan = INVITED_USERS[1].userId;

    const confirmed = await confirmCard(app, "base1-58");
    const purchased = await json<{ item: { inventoryItemId: string; userId: string } }>(
      app,
      "/v1/inventory/purchased",
      {
        method: "POST",
        body: JSON.stringify({
          confirmationId: confirmed.confirmation.confirmationId,
          purchasePrice: "10.50",
          purchasedAt: "2026-09-16",
          referencePriceAmount: "8.00",
        }),
      },
    );
    expect(purchased.status).toBe(201);

    const switched = await json<{
      token: string;
      identity: { userId: string };
    }>(app, "/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ inviteCode: JORDAN_INVITE_CODE }),
    });
    expect(switched.status).toBe(200);
    expect(switched.body.identity.userId).toBe(jordan);
    expect(switched.body.identity.userId).not.toBe(INVITED_USERS[0].userId);

    const jordanInventory = await json<{ items: unknown[] }>(app, "/v1/inventory", {
      headers: { authorization: `Bearer ${switched.body.token}` },
    });
    expect(jordanInventory.body.items).toEqual([]);

    const blocked = await json<{ error: string }>(app, "/v1/inventory/purchased", {
      method: "POST",
      headers: { authorization: `Bearer ${switched.body.token}` },
      body: JSON.stringify({
        confirmationId: confirmed.confirmation.confirmationId,
        purchasePrice: "10.50",
        purchasedAt: "2026-09-16",
      }),
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe("Confirm the card before Purchased");

    const alexInventory = await json<{ items: Array<{ inventoryItemId: string }> }>(
      app,
      "/v1/inventory",
    );
    expect(alexInventory.body.items).toHaveLength(1);
    expect(alexInventory.body.items[0]?.inventoryItemId).toBe(purchased.body.item.inventoryItemId);
  });

  it("kill and reopen: Purchased copy, draft, prefs survive; watchlist Max Buy is live", async () => {
    const { sqlitePath, app: firstApp } = openFileApp();
    const tighter = { ...DEFAULT_MAX_BUY_PREFERENCES, targetMarginPct: 0.3 };
    const liveWatchlist = recomputeCopyMaxBuy({ referencePriceAmount: "8.00" }, tighter);

    const purchasedConfirm = await confirmCard(firstApp, "base1-58");
    const purchased = await json<{
      item: { inventoryItemId: string; intent: string; purchase: { costBasis: { allInTotal: string } } };
    }>(firstApp, "/v1/inventory/purchased", {
      method: "POST",
      body: JSON.stringify({
        confirmationId: purchasedConfirm.confirmation.confirmationId,
        purchasePrice: "10.50",
        purchasedAt: "2026-09-16",
        shipping: "1.25",
        referencePriceAmount: "8.00",
        condition: "NM",
      }),
    });
    expect(purchased.status).toBe(201);
    expect(purchased.body.item.purchase.costBasis.allInTotal).toBe("11.75");

    const draft = await json<{ draft: { draftId: string; title: string } }>(
      firstApp,
      `/v1/inventory/${purchased.body.item.inventoryItemId}/drafts`,
      { method: "POST" },
    );
    expect(draft.status).toBe(201);

    const watchConfirm = await confirmCard(firstApp, "base1-4");
    const watchlist = await json<{
      item: { inventoryItemId: string; referencePriceAmount: string | null; targetMaxBuyAmount: string | null };
    }>(firstApp, "/v1/inventory/watchlist", {
      method: "POST",
      body: JSON.stringify({
        confirmationId: watchConfirm.confirmation.confirmationId,
        referencePriceAmount: "8.00",
      }),
    });
    expect(watchlist.status).toBe(201);

    const prefs = await json<{ preferences: { targetMarginPct: number } }>(
      firstApp,
      "/v1/preferences",
      {
        method: "PATCH",
        body: JSON.stringify({ targetMarginPct: 0.3 }),
      },
    );
    expect(prefs.body.preferences.targetMarginPct).toBe(0.3);

    const { app } = reopen(sqlitePath);

    const identity = await json<{ identity: { userId: string } }>(app, "/v1/identity");
    expect(identity.body.identity.userId).toBe(INVITED_USERS[0].userId);

    const savedPrefs = await json<{ preferences: { targetMarginPct: number } }>(
      app,
      "/v1/preferences",
    );
    expect(savedPrefs.body.preferences.targetMarginPct).toBe(0.3);

    const inventory = await json<{
      items: Array<{
        inventoryItemId: string;
        intent: string;
        referencePriceAmount: string | null;
        targetMaxBuyAmount: string | null;
        purchase: { costBasis: { allInTotal: string } } | null;
        draft: { draftId: string } | null;
        card: { tcgdexId: string } | null;
      }>;
    }>(app, "/v1/inventory");
    expect(inventory.status).toBe(200);

    const purchasedCopy = inventory.body.items.find((item) => item.intent === "purchased");
    const watchCopy = inventory.body.items.find((item) => item.intent === "watchlist");

    expect(purchasedCopy?.inventoryItemId).toBe(purchased.body.item.inventoryItemId);
    expect(purchasedCopy?.purchase?.costBasis.allInTotal).toBe("11.75");
    expect(purchasedCopy?.draft?.draftId).toBe(draft.body.draft.draftId);
    expect(purchasedCopy?.card?.tcgdexId).toBe("base1-58");

    expect(watchCopy?.referencePriceAmount).toBe("8.00");
    expect(watchCopy?.targetMaxBuyAmount).toBe(liveWatchlist.maxBuyAmount);
    expect(watchCopy?.targetMaxBuyAmount).not.toBe("5.57");
    expect(watchCopy?.card?.tcgdexId).toBe("base1-4");
  });

  it("scan → confirm → Purchased → draft → Copy survives reopen; Copy omits notes", async () => {
    const privateNotes = "Private: all-in was $11.75. Maybe list on eBay later.";
    const { sqlitePath, app: firstApp } = openFileApp();

    const confirmed = await confirmCard(firstApp, "base1-58");
    const purchased = await json<{
      item: { inventoryItemId: string; intent: string };
    }>(firstApp, "/v1/inventory/purchased", {
      method: "POST",
      body: JSON.stringify({
        confirmationId: confirmed.confirmation.confirmationId,
        purchasePrice: "10.50",
        purchasedAt: "2026-09-16",
        shipping: "1.25",
        referencePriceAmount: "8.00",
        condition: "NM",
      }),
    });
    expect(purchased.status).toBe(201);

    const draft = await json<{ draft: { draftId: string } }>(
      firstApp,
      `/v1/inventory/${purchased.body.item.inventoryItemId}/drafts`,
      { method: "POST" },
    );
    expect(draft.status).toBe(201);

    const patched = await json<{ draft: { draftId: string; notes: string } }>(
      firstApp,
      `/v1/drafts/${draft.body.draft.draftId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          askingPrice: "15.00",
          notes: privateNotes,
          intendedChannelNote: "Maybe list on eBay later",
        }),
      },
    );
    expect(patched.status).toBe(200);
    expect(patched.body.draft.notes).toBe(privateNotes);

    const copyBefore = await json<{
      clipboard: {
        omittedPrivateNotes: boolean;
        omittedChannelNote: boolean;
        published: boolean;
        plainText: string;
      };
    }>(firstApp, `/v1/drafts/${draft.body.draft.draftId}/clipboard`);
    expect(copyBefore.status).toBe(200);
    expect(copyBefore.body.clipboard.omittedPrivateNotes).toBe(true);
    expect(copyBefore.body.clipboard.omittedChannelNote).toBe(true);
    expect(copyBefore.body.clipboard.published).toBe(false);
    expect(copyBefore.body.clipboard.plainText).toContain("15.00");
    expect(copyBefore.body.clipboard.plainText).not.toContain("Private");
    expect(copyBefore.body.clipboard.plainText).not.toContain("eBay");

    const { app } = reopen(sqlitePath);

    const inventory = await json<{
      items: Array<{
        inventoryItemId: string;
        intent: string;
        draft: { draftId: string } | null;
        card: { tcgdexId: string; name: string } | null;
      }>;
    }>(app, "/v1/inventory");
    expect(inventory.status).toBe(200);
    expect(inventory.body.items).toHaveLength(1);
    expect(inventory.body.items[0]?.intent).toBe("purchased");
    expect(inventory.body.items[0]?.inventoryItemId).toBe(
      purchased.body.item.inventoryItemId,
    );
    expect(inventory.body.items[0]?.draft?.draftId).toBe(draft.body.draft.draftId);
    expect(inventory.body.items[0]?.card?.tcgdexId).toBe("base1-58");

    const savedDraft = await json<{ draft: { notes: string } }>(
      app,
      `/v1/drafts/${draft.body.draft.draftId}`,
    );
    expect(savedDraft.body.draft.notes).toBe(privateNotes);

    const copyAfter = await json<{
      clipboard: { omittedPrivateNotes: boolean; published: boolean; plainText: string };
    }>(app, `/v1/drafts/${draft.body.draft.draftId}/clipboard`);
    expect(copyAfter.status).toBe(200);
    expect(copyAfter.body.clipboard.omittedPrivateNotes).toBe(true);
    expect(copyAfter.body.clipboard.published).toBe(false);
    expect(copyAfter.body.clipboard.plainText).toContain("15.00");
    expect(copyAfter.body.clipboard.plainText).not.toContain("Private");
    expect(copyAfter.body.clipboard.plainText).not.toContain("eBay");
    expect(copyAfter.body.clipboard.plainText).not.toContain(privateNotes);
  });
});
