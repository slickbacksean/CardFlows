import { describe, expect, it } from "vitest";
import { createPokecollectorAccounts, type PokecollectorUserMapping } from "./pokecollector-accounts";

/**
 * Backend re-review (P4): what account deletion does on PokéCollector. Routes and rules follow the
 * pinned PokéCollector v1.51 API (DELETE /api/auth/users/{id} is admin-only and deletes every
 * row the user owns; items delete with DELETE /api/collection/{id} and /api/wishlist/{id}).
 */
type Call = { method: string; path: string; body: unknown; auth: string | null };

function fakePokecollector(options: { adminDelete: number; adminPut?: number }) {
  const calls: Call[] = [];
  const collection = new Map([
    ["11", { id: 11, card_id: "sv1-1_en" }],
    ["12", { id: 12, card_id: "sv1-2_en" }],
  ]);
  const wishlist = new Map([["21", { id: 21, card_id: "sv1-3_en" }]]);
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const method = (init.method ?? "GET").toUpperCase();
    const auth = new Headers(init.headers).get("authorization");
    let body: unknown = null;
    if (typeof init.body === "string") body = init.body.startsWith("{") ? JSON.parse(init.body) : init.body;
    else if (init.body instanceof URLSearchParams) body = Object.fromEntries(init.body);
    calls.push({ method, path: url.pathname, body, auth });
    const reply = (status: number, value: unknown = {}) => new Response(JSON.stringify(value), { status });
    if (method === "DELETE" && url.pathname === "/api/auth/users/7") return reply(options.adminDelete);
    if (method === "PUT" && url.pathname === "/api/auth/users/7") return reply(options.adminPut ?? 200);
    if (method === "POST" && url.pathname === "/api/auth/login") return reply(200, { access_token: "user-token", user: { id: 7 } });
    if (method === "GET" && url.pathname === "/api/collection/") return reply(200, [...collection.values()]);
    if (method === "GET" && url.pathname === "/api/wishlist/") return reply(200, [...wishlist.values()]);
    const item = url.pathname.match(/^\/api\/(collection|wishlist)\/(\d+)$/);
    if (method === "DELETE" && item) {
      (item[1] === "collection" ? collection : wishlist).delete(item[2]!);
      return reply(200, { message: "Removed" });
    }
    if (method === "PUT" && url.pathname === "/api/auth/me/password") return reply(200);
    return reply(404, { detail: "Not Found" });
  };
  return { calls, collection, wishlist, fetchImpl };
}

const mapping: PokecollectorUserMapping = {
  userId: "acct_1",
  pokecollectorUserId: "7",
  pokecollectorUsername: "cardflow-sean",
  updatedAt: "2026-10-17T00:00:00.000Z",
};

describe("PokéCollector remote delete on account deletion", () => {
  it("deletes the remote user with the admin API when allowed (strongest option)", async () => {
    const fake = fakePokecollector({ adminDelete: 200 });
    const accounts = createPokecollectorAccounts({ baseUrl: "http://pc.test", token: "admin-token", passwordPepper: "pepper", fetchImpl: fake.fetchImpl, maxRetries: 0 });
    expect(await accounts.deleteRemoteUser(mapping)).toBe("user_deleted");
    expect(fake.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["DELETE /api/auth/users/7"]);
    expect(fake.calls[0]!.auth).toBe("Bearer admin-token");
  });

  it("an already-deleted remote user (404) counts as deleted", async () => {
    const fake = fakePokecollector({ adminDelete: 404 });
    const accounts = createPokecollectorAccounts({ baseUrl: "http://pc.test", token: "admin-token", passwordPepper: "pepper", fetchImpl: fake.fetchImpl, maxRetries: 0 });
    expect(await accounts.deleteRemoteUser(mapping)).toBe("user_deleted");
  });

  it("without admin rights: deletes every collection and wishlist item as the user, then rotates the password", async () => {
    const fake = fakePokecollector({ adminDelete: 403, adminPut: 403 });
    const accounts = createPokecollectorAccounts({ baseUrl: "http://pc.test", token: "admin-token", passwordPepper: "pepper", fetchImpl: fake.fetchImpl, maxRetries: 0 });
    expect(await accounts.deleteRemoteUser(mapping)).toBe("cards_deleted");
    expect(fake.collection.size).toBe(0);
    expect(fake.wishlist.size).toBe(0);
    const paths = fake.calls.map((c) => `${c.method} ${c.path}`);
    expect(paths).toContain("DELETE /api/collection/11");
    expect(paths).toContain("DELETE /api/collection/12");
    expect(paths).toContain("DELETE /api/wishlist/21");
    expect(paths.at(-1)).toBe("PUT /api/auth/me/password");
    const rotated = fake.calls.at(-1)!.body as { new_password: string; current_password: string };
    expect(rotated.new_password).toMatch(/^cf-[A-Za-z0-9_-]{32}$/);
    expect(rotated.new_password).not.toBe(rotated.current_password);
  });

  it("prefers the admin password reset (and deactivates the user) when the admin can't delete", async () => {
    const fake = fakePokecollector({ adminDelete: 500, adminPut: 200 });
    const accounts = createPokecollectorAccounts({ baseUrl: "http://pc.test", token: "admin-token", passwordPepper: "pepper", fetchImpl: fake.fetchImpl, maxRetries: 0 });
    expect(await accounts.deleteRemoteUser(mapping)).toBe("cards_deleted");
    const put = fake.calls.find((c) => c.method === "PUT")!;
    expect(put.path).toBe("/api/auth/users/7");
    expect(put.body).toMatchObject({ is_active: false });
  });

  it("never throws when PokéCollector is unreachable", async () => {
    const accounts = createPokecollectorAccounts({
      baseUrl: "http://pc.test",
      token: "admin-token",
      passwordPepper: "pepper",
      maxRetries: 0,
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(await accounts.deleteRemoteUser(mapping)).toBe("failed");
  });
});
