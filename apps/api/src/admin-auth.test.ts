/**
 * Admin authentication and authorization tests
 */

import { describe, test, expect, beforeEach } from "vitest";
import { adminUserIdsFromEnv, adminEmailsFromEnv, bootstrapAdminRoles, isAdmin, requireAdminRole, logAdminAction, getAdminActions } from "./admin-auth";
import { createSqliteStore } from "./sqlite-store";
import type { Context } from "hono";

describe("adminUserIdsFromEnv", () => {
  test("parses comma-separated user IDs", () => {
    const ids = adminUserIdsFromEnv({ ADMIN_USER_IDS: "user1,user2,user3" });
    expect(ids).toEqual(new Set(["user1", "user2", "user3"]));
  });

  test("trims whitespace", () => {
    const ids = adminUserIdsFromEnv({ ADMIN_USER_IDS: " user1 , user2 , user3 " });
    expect(ids).toEqual(new Set(["user1", "user2", "user3"]));
  });

  test("returns empty set when unset", () => {
    const ids = adminUserIdsFromEnv({});
    expect(ids.size).toBe(0);
  });
});

describe("adminEmailsFromEnv", () => {
  test("parses comma-separated emails (case-insensitive)", () => {
    const emails = adminEmailsFromEnv({ ADMIN_EMAILS: "admin@test.com,Admin2@Test.COM" });
    expect(emails).toEqual(new Set(["admin@test.com", "admin2@test.com"]));
  });

  test("returns empty set when unset", () => {
    const emails = adminEmailsFromEnv({});
    expect(emails.size).toBe(0);
  });
});

describe("Admin role system", () => {
  let store: ReturnType<typeof createSqliteStore>;

  beforeEach(() => {
    store = createSqliteStore({ sqlitePath: ":memory:" });
  });

  test("bootstrapAdminRoles grants role by user ID", async () => {
    // Create test users
    const at = new Date().toISOString();
    const user1 = store.accounts.createAccount({
      email: "user1@test.com",
      passwordHash: "hash1",
      at,
    });
    const user2 = store.accounts.createAccount({
      email: "user2@test.com",
      passwordHash: "hash2",
      at,
    });

    if (!user1 || !user2) throw new Error("Failed to create test users");

    const result = await bootstrapAdminRoles(store, { ADMIN_USER_IDS: user1.userId });
    expect(result.granted).toBe(1);

    const isAdminUser1 = await isAdmin(user1.userId, store);
    const isAdminUser2 = await isAdmin(user2.userId, store);
    expect(isAdminUser1).toBe(true);
    expect(isAdminUser2).toBe(false);
  });

  test("bootstrapAdminRoles grants role by email (case-insensitive)", async () => {
    const at = new Date().toISOString();
    const admin = store.accounts.createAccount({
      email: "Admin@Test.COM",
      passwordHash: "hash1",
      at,
    });

    if (!admin) throw new Error("Failed to create test user");

    const result = await bootstrapAdminRoles(store, { ADMIN_EMAILS: "admin@test.com" });
    expect(result.granted).toBe(1);

    const isAdminUser = await isAdmin(admin.userId, store);
    expect(isAdminUser).toBe(true);
  });

  test("bootstrapAdminRoles is idempotent", async () => {
    const at = new Date().toISOString();
    const admin = store.accounts.createAccount({
      email: "admin@test.com",
      passwordHash: "hash",
      at,
    });

    if (!admin) throw new Error("Failed to create test user");

    const result1 = await bootstrapAdminRoles(store, { ADMIN_EMAILS: "admin@test.com" });
    expect(result1.granted).toBe(1);

    const result2 = await bootstrapAdminRoles(store, { ADMIN_EMAILS: "admin@test.com" });
    expect(result2.granted).toBe(0); // Already admin
  });

  test("isAdmin returns false for non-admin user", async () => {
    const at = new Date().toISOString();
    const user = store.accounts.createAccount({
      email: "user@test.com",
      passwordHash: "hash",
      at,
    });

    if (!user) throw new Error("Failed to create test user");

    const result = await isAdmin(user.userId, store);
    expect(result).toBe(false);
  });

  test("requireAdminRole returns 401 when no userId", async () => {
    const mockContext = {
      get: (key: string) => undefined,
      json: (data: unknown, status?: number) => ({ json: data, status }),
    } as unknown as Context;

    const result = await requireAdminRole(mockContext, store);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
    }
  });

  test("requireAdminRole returns 403 when not admin", async () => {
    const at = new Date().toISOString();
    const user = store.accounts.createAccount({
      email: "user@test.com",
      passwordHash: "hash",
      at,
    });

    if (!user) throw new Error("Failed to create test user");

    const mockContext = {
      get: (key: string) => (key === "userId" ? user.userId : undefined),
      json: (data: unknown, status?: number) => ({ json: data, status }),
    } as unknown as Context;

    const result = await requireAdminRole(mockContext, store);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
    }
  });

  test("requireAdminRole succeeds for admin user", async () => {
    const at = new Date().toISOString();
    const admin = store.accounts.createAccount({
      email: "admin@test.com",
      passwordHash: "hash",
      at,
    });

    if (!admin) throw new Error("Failed to create test user");

    await bootstrapAdminRoles(store, { ADMIN_USER_IDS: admin.userId });

    const mockContext = {
      get: (key: string) => (key === "userId" ? admin.userId : undefined),
    } as unknown as Context;

    const result = await requireAdminRole(mockContext, store);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.userId).toBe(admin.userId);
    }
  });
});

describe("Admin audit log", () => {
  let store: ReturnType<typeof createSqliteStore>;

  beforeEach(() => {
    store = createSqliteStore({ sqlitePath: ":memory:" });
  });

  test("logAdminAction records action", async () => {
    await logAdminAction(store, {
      adminUserId: "acct_admin",
      actionType: "creator_create",
      targetType: "creator",
      targetId: "cr_test",
      details: { name: "Test Creator" },
    });

    const actions = await getAdminActions(store, { limit: 10 });
    expect(actions).toHaveLength(1);
    expect(actions[0]!.adminUserId).toBe("acct_admin");
    expect(actions[0]!.actionType).toBe("creator_create");
    expect(actions[0]!.targetType).toBe("creator");
    expect(actions[0]!.targetId).toBe("cr_test");
    expect(JSON.parse(actions[0]!.detailsJson)).toEqual({ name: "Test Creator" });
  });

  test("getAdminActions filters by adminUserId", async () => {
    await logAdminAction(store, {
      adminUserId: "acct_admin1",
      actionType: "creator_create",
    });
    await logAdminAction(store, {
      adminUserId: "acct_admin2",
      actionType: "creator_create",
    });

    const actions = await getAdminActions(store, { adminUserId: "acct_admin1" });
    expect(actions).toHaveLength(1);
    expect(actions[0]!.adminUserId).toBe("acct_admin1");
  });

  test("getAdminActions filters by actionType", async () => {
    await logAdminAction(store, {
      adminUserId: "acct_admin",
      actionType: "creator_create",
    });
    await logAdminAction(store, {
      adminUserId: "acct_admin",
      actionType: "report_resolve",
    });

    const actions = await getAdminActions(store, { actionType: "creator_create" });
    expect(actions).toHaveLength(1);
    expect(actions[0]!.actionType).toBe("creator_create");
  });

  test("getAdminActions respects limit and offset", async () => {
    for (let i = 0; i < 5; i++) {
      await logAdminAction(store, {
        adminUserId: "acct_admin",
        actionType: "stats_export",
      });
    }

    const page1 = await getAdminActions(store, { limit: 2, offset: 0 });
    const page2 = await getAdminActions(store, { limit: 2, offset: 2 });

    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page1[0]!.actionId).not.toBe(page2[0]!.actionId);
  });
});
