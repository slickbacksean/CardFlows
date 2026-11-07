import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createSqliteStore, type SqliteStorePort } from "./sqlite-store";

/**
 * Sign-in gate (PRs 104/113): every API route except sign-in/sign-up, /health and the
 * token-protected /ops routes must refuse a request with no session, on the server.
 * The route list comes from the app itself, so a new route is covered automatically.
 */
const PUBLIC: ReadonlyArray<string> = [
  "GET /health",
  "GET /v1/auth/providers",
  "POST /v1/sessions",
  "POST /v1/sessions/guest",
  "POST /v1/sessions/password",
  "POST /v1/sessions/social",
  "POST /v1/accounts",
  "POST /v1/password-resets",
  "POST /v1/password-resets/confirm",
];

const stores: SqliteStorePort[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function concretePath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)(\{[^}]*\})?/g, "x1").replace(/\*$/, "x1");
}

describe("server-side sign-in gate", () => {
  it("401 without auth on every non-public route", async () => {
    const store = createSqliteStore({ sqlitePath: ":memory:" });
    stores.push(store);
    const app = createApp(store, {
      devAutoSession: false,
      guestMode: true,
      appApiKey: null,
      opsToken: "test-ops-token",
      livestreamEnabled: () => true,
      gradeJobs: true,
    });
    const routes = new Map<string, { method: string; path: string }>();
    for (const route of app.routes) {
      if (route.method === "ALL") continue;
      const key = `${route.method} ${route.path}`;
      routes.set(key, { method: route.method, path: route.path });
    }
    const checked: string[] = [];
    for (const [key, { method, path }] of routes) {
      if (PUBLIC.includes(key)) continue;
      const res = await app.request(concretePath(path), {
        method,
        headers: { "content-type": "application/json" },
        body: method === "GET" || method === "HEAD" ? undefined : "{}",
      });
      expect(res.status, key).toBe(401);
      checked.push(key);
    }
    // Sanity: the gate covers the core surfaces.
    for (const must of ["POST /v1/scans", "GET /v1/inventory", "POST /v1/grading/batch", "POST /v1/livestream/identify", "POST /v1/account/delete"]) {
      expect(checked, must).toContain(must);
    }
    expect(checked.length).toBeGreaterThan(50);
  });
});
