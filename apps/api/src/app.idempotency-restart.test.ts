import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createSqliteStore, type SqliteStorePort } from "./sqlite-store";

const dirs: string[] = [];
const stores: SqliteStorePort[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function dbPath() {
  const dir = mkdtempSync(path.join(tmpdir(), "cardflow-idem-"));
  dirs.push(dir);
  return path.join(dir, "db.sqlite");
}
function open(file: string) {
  const store = createSqliteStore({ sqlitePath: file });
  stores.push(store);
  return createApp(store);
}

const post = (app: ReturnType<typeof createApp>, url: string, key: string, body: unknown, method = "POST") =>
  app.request(url, { method, headers: { "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(body) });

describe("idempotency across a restart (SQLite)", () => {
  it("M2: a scan replay after restart with a different body is 422; same body replays", async () => {
    const file = dbPath();
    const first = await post(open(file), "/v1/scans", "scan-k", { captureMethod: "camera_photo" });
    const firstId = ((await first.json()) as { scan: { scanId: string } }).scan.scanId;
    const app = open(file); // restart: empty in-memory registry
    expect((await post(app, "/v1/scans", "scan-k", { captureMethod: "manual_scan" })).status).toBe(422);
    const app2 = open(file);
    const same = await post(app2, "/v1/scans", "scan-k", { captureMethod: "camera_photo" });
    expect(((await same.json()) as { scan: { scanId: string } }).scan.scanId).toBe(firstId);
  });

  it("M3: a queued write replays its stored answer after restart; a different body is 422", async () => {
    const file = dbPath();
    const app = open(file);
    const scan = (await (await post(app, "/v1/scans", "s", { captureMethod: "camera_photo", scenario: "high-confidence" })).json()) as {
      scan: { scanId: string };
    };
    const confirmed = (await (await post(app, `/v1/scans/${scan.scan.scanId}/confirm`, "c", { tcgdexId: "base1-58" })).json()) as {
      confirmation: { confirmationId: string };
    };
    const item = (await (
      await post(app, "/v1/inventory/purchased", "p", { confirmationId: confirmed.confirmation.confirmationId, purchasePrice: "10", purchasedAt: "2026-10-01" })
    ).json()) as { item: { inventoryItemId: string } };
    const url = `/v1/sales/${item.item.inventoryItemId}`;
    const first = await post(app, url, "sale-k", { price: "25", soldAt: "2026-10-05" });
    expect(first.status).toBe(200);
    const firstBody = await first.text();
    const restarted = open(file);
    const replay = await post(restarted, url, "sale-k", { price: "25", soldAt: "2026-10-05" });
    expect(replay.status).toBe(200);
    expect(await replay.text()).toBe(firstBody);
    expect((await post(open(file), url, "sale-k", { price: "99", soldAt: "2026-10-05" })).status).toBe(422);
  });
});
