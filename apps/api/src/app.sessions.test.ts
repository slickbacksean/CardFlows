import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_INVITED_USER_ID,
  INVITED_USERS,
  shouldConfirmAccountSwitch,
} from "@cardflow/shared";
import { createApp } from "./app";
import { ALEX_INVITE_CODE, JORDAN_INVITE_CODE } from "./invited-testers";
import { hashSessionToken, resolveDevAutoSession } from "./session";
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
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? ((await response.json()) as T)
    : ((await response.text()) as T);
  return { status: response.status, body };
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

describe("invite-code sessions", () => {
  const stores: SqliteStorePort[] = [];
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const store of stores.splice(0)) {
      store.close();
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function openApp(options: { devAutoSession?: boolean } = {}) {
    const store = createSqliteStore({ sqlitePath: ":memory:" });
    stores.push(store);
    return { store, app: createApp(store, options) };
  }

  function openFileApp(options: { devAutoSession?: boolean } = {}) {
    const dir = mkdtempSync(path.join(tmpdir(), "cardflow-session-loop-"));
    tempDirs.push(dir);
    const sqlitePath = path.join(dir, "cardflow.sqlite");
    const store = createSqliteStore({ sqlitePath });
    stores.push(store);
    return { sqlitePath, store, app: createApp(store, options) };
  }

  function reopen(sqlitePath: string, options: { devAutoSession?: boolean } = {}) {
    stores.pop()?.close();
    const store = createSqliteStore({ sqlitePath });
    stores.push(store);
    return { store, app: createApp(store, options) };
  }

  async function redeem(app: App, inviteCode: string) {
    const session = await json<{
      token: string;
      identity: { userId: string; label: string };
    }>(app, "/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ inviteCode }),
    });
    expect(session.status).toBe(200);
    return session.body;
  }

  it("redeems Alex's invite as Alex and cannot open Jordan's session", async () => {
    const { store, app } = openApp();
    const alex = INVITED_USERS[0];
    const jordan = INVITED_USERS[1];

    const session = await json<{
      token: string;
      identity: { userId: string; label: string; inviteCode?: string };
      invitedUsers: Array<{ userId: string; inviteCode?: string }>;
      cardflowCardId?: string;
    }>(app, "/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ inviteCode: ALEX_INVITE_CODE }),
    });

    expect(session.status).toBe(200);
    expect(session.body.token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(session.body.token).not.toBe(ALEX_INVITE_CODE);
    expect(session.body.identity).toEqual({ userId: alex.userId, label: alex.label });
    expect(session.body.identity.userId).not.toBe(jordan.userId);
    expect(session.body.identity).not.toHaveProperty("inviteCode");
    expect(session.body.invitedUsers.some((user) => "inviteCode" in user)).toBe(false);
    expect(session.body.cardflowCardId).toBeUndefined();

    const stored = store.getSessionByToken(session.body.token);
    expect(stored?.userId).toBe(alex.userId);
    expect(stored).not.toHaveProperty("token");
    expect(JSON.stringify(stored)).not.toContain(session.body.token);

    const identity = await json<{ identity: { userId: string } }>(app, "/v1/identity", {
      headers: bearer(session.body.token),
    });
    expect(identity.body.identity.userId).toBe(alex.userId);

    const jordanSession = await json<{
      token: string;
      identity: { userId: string };
    }>(app, "/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ inviteCode: JORDAN_INVITE_CODE }),
    });
    expect(jordanSession.status).toBe(200);
    expect(jordanSession.body.identity.userId).toBe(jordan.userId);
    expect(jordanSession.body.identity.userId).not.toBe(alex.userId);
    expect(jordanSession.body.token).not.toBe(session.body.token);

    const stillAlex = await json<{ identity: { userId: string } }>(app, "/v1/identity", {
      headers: bearer(session.body.token),
    });
    expect(stillAlex.body.identity.userId).toBe(alex.userId);
  });

  it("rejects unknown invite codes without minting a cardflow_card_id", async () => {
    const { app } = openApp();
    const before = await json<{ items: unknown[] }>(app, "/v1/inventory");

    const missing = await json<{ error: string; cardflowCardId?: string }>(app, "/v1/sessions", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("Unknown invite code");
    expect(missing.body.cardflowCardId).toBeUndefined();

    const unknown = await json<{ error: string }>(app, "/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ inviteCode: "not-an-invite" }),
    });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error).toBe("Unknown invite code");

    const after = await json<{ items: unknown[] }>(app, "/v1/inventory");
    expect(after.body.items).toHaveLength(before.body.items.length);
  });

  it("stores a hashed token and returns the raw token once", async () => {
    const { store, app } = openApp();
    const created = await json<{ token: string }>(app, "/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ inviteCode: ALEX_INVITE_CODE }),
    });
    expect(created.status).toBe(200);

    const hashed = hashSessionToken(created.body.token);
    expect(store.getSessionByToken(created.body.token)?.userId).toBe(DEFAULT_INVITED_USER_ID);
    expect(hashed).not.toBe(created.body.token);
    expect(hashed).toHaveLength(64);
  });

  it("keeps two concurrent sessions' inventories separate on one API process", async () => {
    const { app } = openApp({ devAutoSession: false });
    const alex = INVITED_USERS[0];
    const jordan = INVITED_USERS[1];

    const alexSession = await json<{ token: string }>(app, "/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ inviteCode: ALEX_INVITE_CODE }),
    });
    const jordanSession = await json<{ token: string }>(app, "/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ inviteCode: JORDAN_INVITE_CODE }),
    });
    expect(alexSession.body.token).not.toBe(jordanSession.body.token);

    const scan = await json<{
      scan: { scanId: string; userId: string };
    }>(app, "/v1/scans", {
      method: "POST",
      headers: bearer(alexSession.body.token),
      body: JSON.stringify({ captureMethod: "camera_photo", scenario: "high-confidence" }),
    });
    expect(scan.status).toBe(201);
    expect(scan.body.scan.userId).toBe(alex.userId);

    const confirmed = await json<{
      confirmation: { confirmationId: string };
    }>(app, `/v1/scans/${scan.body.scan.scanId}/confirm`, {
      method: "POST",
      headers: bearer(alexSession.body.token),
      body: JSON.stringify({ tcgdexId: "base1-58" }),
    });
    expect(confirmed.status).toBe(200);

    const purchased = await json<{ item: { userId: string } }>(app, "/v1/inventory/purchased", {
      method: "POST",
      headers: bearer(alexSession.body.token),
      body: JSON.stringify({
        confirmationId: confirmed.body.confirmation.confirmationId,
        purchasePrice: "10.50",
        purchasedAt: "2026-09-16",
      }),
    });
    expect(purchased.status).toBe(201);
    expect(purchased.body.item.userId).toBe(alex.userId);

    const jordanInventory = await json<{ items: unknown[] }>(app, "/v1/inventory", {
      headers: bearer(jordanSession.body.token),
    });
    expect(jordanInventory.status).toBe(200);
    expect(jordanInventory.body.items).toEqual([]);

    const alexInventory = await json<{ items: Array<{ userId: string }> }>(app, "/v1/inventory", {
      headers: bearer(alexSession.body.token),
    });
    expect(alexInventory.body.items).toHaveLength(1);
    expect(alexInventory.body.items[0]?.userId).toBe(alex.userId);
    expect(alexInventory.body.items[0]?.userId).not.toBe(jordan.userId);

    const missing = await json<{ error: string }>(app, "/v1/inventory/purchased", {
      method: "POST",
      body: JSON.stringify({
        confirmationId: confirmed.body.confirmation.confirmationId,
        purchasePrice: "10.50",
        purchasedAt: "2026-09-16",
      }),
    });
    expect(missing.status).toBe(401);
    expect(missing.body.error).toBe("Unauthorized");
  });

  it("uses auto-session as the default invited user when the header is missing", async () => {
    const { app } = openApp({ devAutoSession: true });
    const identity = await json<{ identity: { userId: string } }>(app, "/v1/identity");
    expect(identity.status).toBe(200);
    expect(identity.body.identity.userId).toBe(DEFAULT_INVITED_USER_ID);

    const scan = await json<{ scan: { userId: string } }>(app, "/v1/scans", {
      method: "POST",
      body: JSON.stringify({ captureMethod: "camera_photo" }),
    });
    expect(scan.status).toBe(201);
    expect(scan.body.scan.userId).toBe(DEFAULT_INVITED_USER_ID);
  });

  it("defaults auto-session off unless CARD_FLOW_DEV_AUTO_SESSION=true", () => {
    expect(resolveDevAutoSession({})).toBe(false);
    expect(resolveDevAutoSession({ NODE_ENV: "test" })).toBe(false);
    expect(resolveDevAutoSession({ NODE_ENV: "production" })).toBe(false);
    expect(resolveDevAutoSession({ CARD_FLOW_DEV_AUTO_SESSION: "false" })).toBe(false);
    expect(resolveDevAutoSession({ NODE_ENV: "production", CARD_FLOW_DEV_AUTO_SESSION: "true" })).toBe(
      true,
    );
  });

  it("as Alex, Purchased survives Jordan switch, switch-back, and API restart", async () => {
    const alex = INVITED_USERS[0];
    const jordan = INVITED_USERS[1];
    const { sqlitePath, app: firstApp } = openFileApp({ devAutoSession: false });

    const alexSession = await redeem(firstApp, ALEX_INVITE_CODE);
    expect(alexSession.identity.userId).toBe(alex.userId);
    expect(alexSession.identity).not.toHaveProperty("inviteCode");

    const scan = await json<{ scan: { scanId: string; userId: string } }>(firstApp, "/v1/scans", {
      method: "POST",
      headers: bearer(alexSession.token),
      body: JSON.stringify({ captureMethod: "camera_photo", scenario: "high-confidence" }),
    });
    expect(scan.status).toBe(201);
    expect(scan.body.scan.userId).toBe(alex.userId);

    const confirmed = await json<{ confirmation: { confirmationId: string } }>(
      firstApp,
      `/v1/scans/${scan.body.scan.scanId}/confirm`,
      {
        method: "POST",
        headers: bearer(alexSession.token),
        body: JSON.stringify({ tcgdexId: "base1-58" }),
      },
    );
    expect(confirmed.status).toBe(200);

    const purchased = await json<{ item: { inventoryItemId: string; userId: string } }>(
      firstApp,
      "/v1/inventory/purchased",
      {
        method: "POST",
        headers: bearer(alexSession.token),
        body: JSON.stringify({
          confirmationId: confirmed.body.confirmation.confirmationId,
          purchasePrice: "10.50",
          purchasedAt: "2026-09-16",
        }),
      },
    );
    expect(purchased.status).toBe(201);
    expect(purchased.body.item.userId).toBe(alex.userId);

    const alexBeforeSwitch = await json<{ items: Array<{ inventoryItemId: string }> }>(
      firstApp,
      "/v1/inventory",
      { headers: bearer(alexSession.token) },
    );
    expect(alexBeforeSwitch.body.items).toHaveLength(1);
    expect(
      shouldConfirmAccountSwitch({
        currentUserId: alex.userId,
        nextUserId: jordan.userId,
        currentInventoryCount: alexBeforeSwitch.body.items.length,
      }),
    ).toBe(true);

    const jordanSession = await redeem(firstApp, JORDAN_INVITE_CODE);
    expect(jordanSession.identity.userId).toBe(jordan.userId);
    expect(jordanSession.token).not.toBe(alexSession.token);

    const jordanInventory = await json<{ items: unknown[] }>(firstApp, "/v1/inventory", {
      headers: bearer(jordanSession.token),
    });
    expect(jordanInventory.status).toBe(200);
    expect(jordanInventory.body.items).toEqual([]);

    const alexBack = await redeem(firstApp, ALEX_INVITE_CODE);
    expect(alexBack.identity.userId).toBe(alex.userId);
    expect(alexBack.token).not.toBe(alexSession.token);
    expect(alexBack.token).not.toBe(jordanSession.token);

    const alexAfterSwitchBack = await json<{
      items: Array<{ inventoryItemId: string; userId: string }>;
    }>(firstApp, "/v1/inventory", { headers: bearer(alexBack.token) });
    expect(alexAfterSwitchBack.body.items).toHaveLength(1);
    expect(alexAfterSwitchBack.body.items[0]?.inventoryItemId).toBe(
      purchased.body.item.inventoryItemId,
    );
    expect(alexAfterSwitchBack.body.items[0]?.userId).toBe(alex.userId);

    const { app } = reopen(sqlitePath, { devAutoSession: false });

    const missing = await json<{ error: string }>(app, "/v1/inventory");
    expect(missing.status).toBe(401);
    expect(missing.body.error).toBe("Unauthorized");

    const restoredIdentity = await json<{ identity: { userId: string; label: string } }>(
      app,
      "/v1/identity",
      { headers: bearer(alexBack.token) },
    );
    expect(restoredIdentity.status).toBe(200);
    expect(restoredIdentity.body.identity).toEqual({ userId: alex.userId, label: alex.label });
    expect(restoredIdentity.body.identity).not.toHaveProperty("inviteCode");

    const restoredAlex = await json<{
      items: Array<{ inventoryItemId: string; userId: string }>;
    }>(app, "/v1/inventory", { headers: bearer(alexBack.token) });
    expect(restoredAlex.status).toBe(200);
    expect(restoredAlex.body.items).toHaveLength(1);
    expect(restoredAlex.body.items[0]?.inventoryItemId).toBe(purchased.body.item.inventoryItemId);
    expect(restoredAlex.body.items[0]?.userId).toBe(alex.userId);

    const stillJordan = await json<{ items: unknown[] }>(app, "/v1/inventory", {
      headers: bearer(jordanSession.token),
    });
    expect(stillJordan.body.items).toEqual([]);
  });
});
