import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createMockPokecollectorAccounts, type PokecollectorRemoteDeletion } from "./pokecollector-accounts";
import { OpsMetrics } from "./ops-metrics";
import {
  POKECOLLECTOR_DELETION_BACKOFF_MS,
  POKECOLLECTOR_DELETION_MAX_ATTEMPTS,
  nextPokecollectorDeletionAttempt,
  type PokecollectorDeletionQueue,
} from "./pokecollector-deletion-queue";
import {
  createPokecollectorPacer,
  POKECOLLECTOR_LOGINS_PER_MINUTE_LIMIT,
  POKECOLLECTOR_REQUESTS_PER_MINUTE_LIMIT,
  unpacedPokecollector,
} from "./pokecollector-pacer";
import { createSqliteStore, type SqliteStorePort } from "./sqlite-store";
import { createMemoryStore, type StorePort } from "./store";

/**
 * Backend re-review H1/M1 (P4): PokéCollector deletes after an account delete are queued in
 * pokecollector_pending_deletions (remote ID only), run in the background with backoff and
 * pacing, and the delete response never waits on PokéCollector.
 */
const stores: SqliteStorePort[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

type App = ReturnType<typeof createApp>;
async function call(app: App, url: string, init: { method?: string; body?: unknown; token?: string } = {}) {
  const res = await app.request(url, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { "content-type": "application/json", ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
const PW = "correct horse battery";

function world(options: { store?: StorePort; deleteResults?: PokecollectorRemoteDeletion[] } = {}) {
  let clock = new Date("2026-10-17T18:00:00.000Z");
  const store =
    options.store ??
    (() => {
      const s = createSqliteStore({ sqlitePath: ":memory:" });
      stores.push(s);
      return s;
    })();
  const accounts = createMockPokecollectorAccounts();
  const results = [...(options.deleteResults ?? [])];
  const calls: string[] = [];
  const realDelete = accounts.deleteRemoteUser.bind(accounts);
  let gate: Promise<void> | null = null;
  accounts.deleteRemoteUser = async (target, opts) => {
    calls.push(target.pokecollectorUserId);
    if (gate) await gate;
    const next = results.shift();
    if (next && next !== "user_deleted") return next;
    return realDelete(target, opts);
  };
  let queue!: PokecollectorDeletionQueue;
  const metrics = new OpsMetrics();
  const app = createApp(store, {
    opsToken: "ops-token",
    opsMetrics: metrics,
    devAutoSession: false,
    guestMode: true,
    orphanSweepIntervalMs: 0,
    pokecollectorDeletionIntervalMs: 0,
    pokecollectorAccounts: accounts,
    pokecollectorPacer: unpacedPokecollector,
    onPokecollectorDeletionQueue: (q) => (queue = q),
    now: () => clock,
  });
  return {
    app,
    store,
    accounts,
    calls,
    metrics,
    queue: () => queue,
    advance: (ms: number) => (clock = new Date(clock.getTime() + ms)),
    hold: () => {
      let release!: () => void;
      gate = new Promise((resolve) => (release = resolve));
      return () => {
        gate = null;
        release();
      };
    },
  };
}

async function linkedAccount(app: App, email: string) {
  const up = await call(app, "/v1/accounts", { body: { email, password: PW, ageConfirmed18Plus: true } });
  const token = up.body.token as string;
  const userId = (up.body.identity as { userId: string }).userId;
  expect((await call(app, "/v1/identity", { token })).status).toBe(200);
  return { token, userId };
}

describe("PokéCollector deletion queue (Backend re-review H1/M1)", () => {
  it("queues the remote ID in the delete's transaction; the response doesn't wait on PokéCollector", async () => {
    const w = world();
    const { token, userId } = await linkedAccount(w.app, "queued@example.com");
    const mapping = w.store.getPokecollectorUserMapping(userId)!;
    await w.accounts.addPurchased(mapping, { tcgdexId: "sv1-1" });
    await w.accounts.addWatchlist(mapping, { tcgdexId: "sv1-2" });
    const release = w.hold(); // PokéCollector hangs
    const res = await call(w.app, "/v1/account/delete", { method: "POST", token, body: { password: PW } });
    expect(res.status).toBe(200);
    expect(res.body.pokecollector).toBe("queued");
    expect(w.store.getPokecollectorUserMapping(userId)).toBeUndefined();
    const rows = w.store.accounts.listPokecollectorDeletions();
    expect(rows).toEqual([expect.objectContaining({ remoteUserId: mapping.pokecollectorUserId, mode: "delete", attempts: 0 })]);
    // Remote ID only: no PokeSniper user ID, email or PokéCollector username.
    const stored = JSON.stringify(rows);
    for (const secret of [userId, "queued@example.com", "queued", mapping.pokecollectorUsername]) expect(stored).not.toContain(secret);
    release();
    await w.queue().run();
    expect(w.store.accounts.listPokecollectorDeletions()).toEqual([]);
    expect(await w.accounts.listCollection(mapping)).toEqual([]);
    expect(await w.accounts.listWishlist(mapping)).toEqual([]);
  });

  it("a failed delete is retried with backoff, and survives a restart (the row is in SQLite)", async () => {
    const w = world({ deleteResults: ["failed", "partial"] });
    const { token, userId } = await linkedAccount(w.app, "retry@example.com");
    const remote = w.store.getPokecollectorUserMapping(userId)!.pokecollectorUserId;
    await call(w.app, "/v1/account/delete", { method: "POST", token, body: { password: PW } });
    await w.queue().run();
    let row = w.store.accounts.listPokecollectorDeletions()[0]!;
    expect(row).toEqual(expect.objectContaining({ attempts: 1, lastResult: "failed" }));
    expect(Date.parse(row.nextAttemptAt) - Date.parse("2026-10-17T18:00:00.000Z")).toBe(POKECOLLECTOR_DELETION_BACKOFF_MS[0]);
    // Not due yet: nothing is sent.
    await w.queue().run();
    expect(w.calls).toEqual([remote]);
    w.advance(POKECOLLECTOR_DELETION_BACKOFF_MS[0]);
    await w.queue().run();
    row = w.store.accounts.listPokecollectorDeletions()[0]!;
    expect(row).toEqual(expect.objectContaining({ attempts: 2, lastResult: "partial" }));
    w.advance(POKECOLLECTOR_DELETION_BACKOFF_MS[1]);
    await w.queue().run();
    expect(w.store.accounts.listPokecollectorDeletions()).toEqual([]);
    expect(w.calls).toEqual([remote, remote, remote]);
  });

  it("backoff grows to daily, so an outage of a few days still ends with the user deleted", () => {
    const t0 = new Date("2026-10-17T00:00:00.000Z");
    let total = 0;
    for (let attempt = 1; attempt <= 10; attempt += 1) total += Date.parse(nextPokecollectorDeletionAttempt(attempt, t0)) - t0.getTime();
    expect(Date.parse(nextPokecollectorDeletionAttempt(50, t0)) - t0.getTime()).toBe(24 * 3_600_000);
    // Ten attempts span about four days.
    expect(total / 86_400_000).toBeGreaterThan(3);
    expect(total / 86_400_000).toBeLessThan(5);
  });

  it("a remote user other PokeSniper users are linked to is held, never deleted (memory twin allows the share)", async () => {
    const w = world({ store: createMemoryStore() });
    const { token, userId } = await linkedAccount(w.app, "shared@example.com");
    const mapping = w.store.getPokecollectorUserMapping(userId)!;
    w.store.savePokecollectorUserMapping({ ...mapping, userId: "someone-else" });
    const res = await call(w.app, "/v1/account/delete", { method: "POST", token, body: { password: PW } });
    expect(res.body.pokecollector).toBe("held");
    await w.queue().run();
    expect(w.calls).toEqual([]);
    expect(w.store.accounts.listPokecollectorDeletions()).toEqual([expect.objectContaining({ remoteUserId: mapping.pokecollectorUserId, mode: "hold" })]);
  });

  it("a row turns into a hold if someone is linked to that remote user before it runs", async () => {
    const w = world();
    const { userId } = await linkedAccount(w.app, "late@example.com");
    const mapping = w.store.getPokecollectorUserMapping(userId)!;
    // A queued row for a remote user that a PokeSniper user is linked to (again) by the time it runs.
    w.store.accounts.enqueuePokecollectorDeletion({ remoteUserId: mapping.pokecollectorUserId, mode: "delete", at: "2026-10-17T00:00:00.000Z" });
    await w.queue().run();
    expect(w.calls).toEqual([]);
    expect(w.store.accounts.listPokecollectorDeletions()[0]).toEqual(expect.objectContaining({ mode: "hold", lastResult: "shared" }));
  });

  it("a guest's PokéCollector user (shared) is held, never deleted", async () => {
    const w = world();
    const guest = await call(w.app, "/v1/sessions/guest", { method: "POST" });
    const token = guest.body.token as string;
    const userId = (guest.body.identity as { userId: string }).userId;
    await call(w.app, "/v1/identity", { token });
    const mapping = w.store.getPokecollectorUserMapping(userId);
    const res = await call(w.app, "/v1/account/delete", { method: "POST", token });
    expect(res.status).toBe(200);
    await w.queue().run();
    expect(w.calls).toEqual([]);
    if (mapping) {
      expect(res.body.pokecollector).toBe("held");
      expect(w.store.accounts.listPokecollectorDeletions()).toEqual([expect.objectContaining({ mode: "hold" })]);
    } else {
      expect(res.body.pokecollector).toBe("not_linked");
    }
  });

  it("a PokéCollector that throws never blocks or fails the delete", async () => {
    const w = world();
    w.accounts.deleteRemoteUser = () => {
      throw new Error("pokecollector down");
    };
    const { token } = await linkedAccount(w.app, "down@example.com");
    const res = await call(w.app, "/v1/account/delete", { method: "POST", token, body: { password: PW } });
    expect(res.status).toBe(200);
    await w.queue().run();
    expect(w.store.accounts.listPokecollectorDeletions()[0]).toEqual(expect.objectContaining({ attempts: 1, lastResult: "failed" }));
  });
});

describe("PokéCollector deletion limits (Backend final review R3)", () => {
  it(`gives up after ${POKECOLLECTOR_DELETION_MAX_ATTEMPTS} attempts: marked failed, alerted, counted in /ops`, async () => {
    const w = world({ deleteResults: Array.from({ length: 40 }, () => "failed" as const) });
    const { token } = await linkedAccount(w.app, "gives-up@example.com");
    await call(w.app, "/v1/account/delete", { method: "POST", token, body: { password: PW } });
    const warn = console.warn;
    const logged: string[] = [];
    console.warn = (...args: unknown[]) => void logged.push(args.join(" "));
    try {
      for (let i = 0; i < POKECOLLECTOR_DELETION_MAX_ATTEMPTS + 5; i += 1) {
        await w.queue().run();
        w.advance(25 * 3_600_000);
      }
    } finally {
      console.warn = warn;
    }
    expect(w.calls).toHaveLength(POKECOLLECTOR_DELETION_MAX_ATTEMPTS);
    const row = w.store.accounts.listPokecollectorDeletions()[0]!;
    expect(row).toEqual(expect.objectContaining({ mode: "failed", attempts: POKECOLLECTOR_DELETION_MAX_ATTEMPTS, lastResult: "failed" }));
    expect(logged.filter((line) => line.includes("[pokecollector-deletion] gave up"))).toHaveLength(1);
    expect(logged.join(" ")).not.toContain("gives-up@example.com");
    const snapshot = w.metrics.snapshot();
    expect(snapshot.pokecollectorDeletionsFailed).toBe(1);
    expect(snapshot.alerts.map((a) => a.kind)).toContain("pokecollector_deletion_failed");
    const ops = await w.app.request("/ops/pokecollector-deletions", { headers: { authorization: "Bearer ops-token" } });
    expect(ops.status).toBe(200);
    const counts = (await ops.json()) as Record<string, unknown>;
    expect(counts).toEqual(expect.objectContaining({ ok: true, pending: 0, held: 0, failed: 1, stuck: 0, maxAttempts: POKECOLLECTOR_DELETION_MAX_ATTEMPTS }));
    expect(JSON.stringify(counts)).not.toContain("remoteUserId");
  });

  it("/ops/pokecollector-deletions counts stuck rows (pending over 3 days) and needs the ops token", async () => {
    const w = world();
    w.store.accounts.enqueuePokecollectorDeletion({ remoteUserId: "501", mode: "delete", at: "2026-10-13T00:00:00.000Z" });
    w.store.accounts.enqueuePokecollectorDeletion({ remoteUserId: "502", mode: "delete", at: "2026-10-17T17:00:00.000Z" });
    w.store.accounts.enqueuePokecollectorDeletion({ remoteUserId: "503", mode: "hold", at: "2026-10-01T00:00:00.000Z" });
    expect((await w.app.request("/ops/pokecollector-deletions")).status).toBe(401);
    const res = await w.app.request("/ops/pokecollector-deletions", { headers: { authorization: "Bearer ops-token" } });
    expect(await res.json()).toEqual({
      ok: true,
      pending: 2,
      held: 1,
      failed: 0,
      stuck: 1,
      oldestPendingAt: "2026-10-13T00:00:00.000Z",
      maxAttempts: POKECOLLECTOR_DELETION_MAX_ATTEMPTS,
    });
  });
});

describe("PokéCollector pacing (Backend re-review M1)", () => {
  it("stays under 60 requests and 5 logins a minute", async () => {
    let t = 0;
    const pacer = createPokecollectorPacer({
      requestsPerMinute: 100, // capped below PokéCollector's limit
      loginsPerMinute: 100,
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
    });
    const requests: number[] = [];
    const logins: number[] = [];
    for (let i = 0; i < 150; i += 1) {
      const kind = i % 3 === 0 ? "login" : "request";
      await pacer.take(kind);
      requests.push(t);
      if (kind === "login") logins.push(t);
    }
    const maxInWindow = (stamps: number[]) =>
      Math.max(...stamps.map((start) => stamps.filter((s) => s >= start && s < start + 60_000).length));
    expect(maxInWindow(requests)).toBeLessThan(POKECOLLECTOR_REQUESTS_PER_MINUTE_LIMIT);
    expect(maxInWindow(logins)).toBeLessThan(POKECOLLECTOR_LOGINS_PER_MINUTE_LIMIT);
  });

  it("defaults leave room for live traffic (30 requests, 2 logins a minute)", async () => {
    let t = 0;
    const pacer = createPokecollectorPacer({ now: () => t, sleep: async (ms) => void (t += ms) });
    for (let i = 0; i < 30; i += 1) await pacer.take("request");
    expect(t).toBe(0);
    await pacer.take("request");
    expect(t).toBe(60_000);
    t = 0;
    const logins = createPokecollectorPacer({ now: () => t, sleep: async (ms) => void (t += ms) });
    await logins.take("login");
    await logins.take("login");
    expect(t).toBe(0);
    await logins.take("login");
    expect(t).toBe(60_000);
  });
});
