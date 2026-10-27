/**
 * Tests for creator code attribution at sign-up
 */

import { describe, it, expect } from "vitest";
import { createApp } from "./app";
import { createSqliteStore } from "./sqlite-store";

describe("Creator Code Attribution", () => {
  const store = createSqliteStore({ sqlitePath: ":memory:" });
  const app = createApp(store, {});

  it("stores creator code on email sign-up", async () => {
    const email = `test-${Date.now()}@example.com`;
    const password = "password123";
    const creatorCode = "TEST_CREATOR_123";

    const response = await app.request("/v1/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        ageConfirmed18Plus: true,
        ageGateVersion: "2026-10-01",
        termsAccepted: true,
        termsVersion: "2026-10-01",
        creatorCode,
      }),
    });

    expect(response.status).toBe(200);
    const result = await response.json() as { ok: boolean; identity?: { userId: string } };
    expect(result.ok).toBe(true);
    expect(result.identity?.userId).toBeTruthy();

    // Verify creator code is stored
    const account = result.identity?.userId ? store.accounts.getAccount(result.identity.userId) : null;
    expect(account?.creatorCode).toBe(creatorCode);
    expect(account?.creatorCodeEnteredAt).toBeTruthy();
  });

  it("works without creator code", async () => {
    const email = `test-${Date.now()}@example.com`;
    const password = "password123";

    const response = await app.request("/v1/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        ageConfirmed18Plus: true,
        ageGateVersion: "2026-10-01",
        termsAccepted: true,
        termsVersion: "2026-10-01",
      }),
    });

    expect(response.status).toBe(200);
    const result = await response.json() as { ok: boolean; identity?: { userId: string } };
    expect(result.ok).toBe(true);

    // Verify no creator code
    const account = result.identity?.userId ? store.accounts.getAccount(result.identity.userId) : null;
    expect(account?.creatorCode).toBeNull();
  });

  it("trims whitespace from creator code", async () => {
    const email = `test-${Date.now()}@example.com`;
    const password = "password123";
    const creatorCode = "  TRIMMED_CODE  ";

    const response = await app.request("/v1/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        ageConfirmed18Plus: true,
        ageGateVersion: "2026-10-01",
        termsAccepted: true,
        termsVersion: "2026-10-01",
        creatorCode,
      }),
    });

    expect(response.status).toBe(200);
    const result = await response.json() as { identity?: { userId: string } };

    const account = result.identity?.userId ? store.accounts.getAccount(result.identity.userId) : null;
    expect(account?.creatorCode).toBe("TRIMMED_CODE");
  });

  it("ignores empty creator code", async () => {
    const email = `test-${Date.now()}@example.com`;
    const password = "password123";

    const response = await app.request("/v1/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        ageConfirmed18Plus: true,
        ageGateVersion: "2026-10-01",
        termsAccepted: true,
        termsVersion: "2026-10-01",
        creatorCode: "  ",
      }),
    });

    expect(response.status).toBe(200);
    const result = await response.json() as { identity?: { userId: string } };

    const account = result.identity?.userId ? store.accounts.getAccount(result.identity.userId) : null;
    expect(account?.creatorCode).toBeNull();
  });
});
