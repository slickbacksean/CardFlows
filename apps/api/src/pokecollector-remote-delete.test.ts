import { describe, expect, it } from "vitest";
import { createPokecollectorAccounts, type PokecollectorUserMapping } from "./pokecollector-accounts";

/**
 * Backend re-review (P4): what account deletion does on PokéCollector. Routes and rules follow the
 * pinned PokéCollector v1.51 API (DELETE /api/auth/users/{id} is admin-only and deletes every
 * row the user owns; items delete with DELETE /api/collection/{id} and /api/wishlist/{id}).
 */
type Call = { method: string; path: string; body: unknown; auth: string | null };

function fakePokecollector(options: { adminDelete: number; adminDeleteBody?: unknown; adminPut?: number }) {
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
    if (method === "DELETE" && url.pathname === "/api/auth/users/7") return reply(options.adminDelete, options.adminDeleteBody ?? {});
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

const link: PokecollectorUserMapping = {
  userId: "acct_1",
  pokecollectorUserId: "7",
  pokecollectorUsername: "cardflow-sean",
  updatedAt: "2026-10-17T00:00:00.000Z",
};
/** What the deletion queue passes while the deleting process still has the link in memory. */
const mapping = { pokecollectorUserId: "7", mapping: link };
/** After a restart the queue only has the remote ID. */
const remoteOnly = { pokecollectorUserId: "7" };

describe("PokéCollector remote delete on account deletion", () => {
  it("deletes the remote user with the admin API when allowed (strongest option)", async () => {
    const fake = fakePokecollector({ adminDelete: 200 });
    const accounts = createPokecollectorAccounts({ baseUrl: "http://pc.test", token: "admin-token", passwordPepper: "pepper", fetchImpl: fake.fetchImpl, maxRetries: 0 });
    expect(await accounts.deleteRemoteUser(mapping)).toBe("user_deleted");
    expect(fake.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["DELETE /api/auth/users/7"]);
    expect(fake.calls[0]!.auth).toBe("Bearer admin-token");
  });

  it("a 404 counts as already deleted only when PokéCollector says \"User not found\"", async () => {
    const gone = fakePokecollector({ adminDelete: 404, adminDeleteBody: { detail: "User not found" } });
    const accounts = createPokecollectorAccounts({ baseUrl: "http://pc.test", token: "admin-token", passwordPepper: "pepper", fetchImpl: gone.fetchImpl, maxRetries: 0 });
    expect(await accounts.deleteRemoteUser(remoteOnly)).toBe("user_deleted");
    expect(gone.calls).toHaveLength(1);
    // A 404 from a missing route (FastAPI's "Not Found", or a proxy page) is not proof.
    for (const body of [{ detail: "Not Found" }, "<html>404</html>", {}]) {
      const missing = fakePokecollector({ adminDelete: 404, adminDeleteBody: body, adminPut: 404 });
      const other = createPokecollectorAccounts({ baseUrl: "http://pc.test", token: "admin-token", passwordPepper: "pepper", fetchImpl: missing.fetchImpl, maxRetries: 0 });
      expect(await other.deleteRemoteUser(remoteOnly), JSON.stringify(body)).toBe("failed");
    }
  });

  it("calls go through the pacer: one login, and a request for every call", async () => {
    const fake = fakePokecollector({ adminDelete: 403, adminPut: 403 });
    const accounts = createPokecollectorAccounts({ baseUrl: "http://pc.test", token: "admin-token", passwordPepper: "pepper", fetchImpl: fake.fetchImpl, maxRetries: 0 });
    const taken: string[] = [];
    await accounts.deleteRemoteUser(mapping, { pacer: { take: async (kind) => void taken.push(kind) } });
    expect(taken.filter((k) => k === "login")).toHaveLength(1);
    // Every HTTP call took a slot (a login counts as a request too).
    expect(taken.length).toBe(fake.calls.length);
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
