import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createSqliteStore } from "./sqlite-store";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

type App = ReturnType<typeof createApp>;
async function call<T>(app: App, p: string, init: RequestInit = {}) {
  const res = await app.request(p, { ...init, headers: { "content-type": "application/json" } });
  return { status: res.status, body: (await res.json()) as T };
}
type Snap = { snapshotId: string; amount: string; source: string; variant: string | null; enteredAt: string };

describe("P1-12 your price snapshots", () => {
  it("saves and lists your prices with pricing off, and survives a restart", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cardflow-price-"));
    dirs.push(dir);
    const sqlitePath = path.join(dir, "cf.sqlite");
    let app = createApp(createSqliteStore({ sqlitePath })); // pricing defaults to off in tests

    const off = await call<{ provider: string; estimate: { amount: string | null } }>(app, "/v1/pricing/cards/base1-58");
    expect(off.body.provider).toBe("off");

    const saved = await call<{ snapshot: Snap }>(app, "/v1/pricing/cards/base1-58/yours", {
      method: "POST",
      body: JSON.stringify({ amount: "$8", variant: "holo" }),
    });
    expect(saved.status).toBe(201);
    expect(saved.body.snapshot).toMatchObject({ amount: "8.00", source: "you", variant: "holo" });

    const bad = await call(app, "/v1/pricing/cards/base1-58/yours", { method: "POST", body: JSON.stringify({ amount: "-1" }) });
    expect(bad.status).toBe(400);

    app = createApp(createSqliteStore({ sqlitePath }));
    const listed = await call<{ snapshots: Snap[] }>(app, "/v1/pricing/cards/base1-58/yours?variant=holo");
    expect(listed.body.snapshots.map((s) => s.amount)).toEqual(["8.00"]);
    const other = await call<{ snapshots: Snap[] }>(app, "/v1/pricing/cards/base1-58/yours?variant=reverse");
    expect(other.body.snapshots).toEqual([]);

    await call(app, "/v1/account/delete", { method: "POST", body: "{}" });
    const gone = await call<{ snapshots: Snap[] }>(app, "/v1/pricing/cards/base1-58/yours");
    expect(gone.body.snapshots).toEqual([]);
  });

  it("keeps each tester's prices separate (memory store)", async () => {
    const app = createApp();
    await call(app, "/v1/pricing/cards/base1-4/yours", { method: "POST", body: JSON.stringify({ amount: 300 }) });
    const listed = await call<{ snapshots: Snap[] }>(app, "/v1/pricing/cards/base1-4/yours");
    expect(listed.body.snapshots[0]?.amount).toBe("300.00");
  });
});
