import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createSqliteStore } from "./sqlite-store";

type App = ReturnType<typeof createApp>;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function post<T>(app: App, p: string, body: unknown) {
  const res = await app.request(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as T };
}

type ScanBody = {
  scan: { scanId: string; mapping: { candidates: Array<{ tcgdexId: string }> } };
  variantSuggestions: Array<{ variant: string }>;
};

const ambiguous = (app: App) => post<ScanBody>(app, "/v1/scans", { captureMethod: "camera_photo", scenario: "ambiguous" });

describe("P1-26 confirm log", () => {
  it("persists confirms to SQLite and promotes the card users keep picking", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cardflow-confirm-"));
    dirs.push(dir);
    const sqlitePath = path.join(dir, "cf.sqlite");
    let store = createSqliteStore({ sqlitePath });
    let app = createApp(store);

    const first = await ambiguous(app);
    const shown = first.body.scan.mapping.candidates.map((c) => c.tcgdexId);
    expect(shown.length).toBeGreaterThan(1);
    const pick = shown[1]!;

    for (let i = 0; i < 3; i += 1) {
      const scan = i === 0 ? first : await ambiguous(app);
      const ok = await post(app, `/v1/scans/${scan.body.scan.scanId}/confirm`, { tcgdexId: pick });
      expect(ok.status).toBe(200);
    }
    const events = store.listConfirmEvents();
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ chosenTcgdexId: pick, chosenRank: 2, via: "candidate" });
    expect(JSON.stringify(events)).not.toMatch(/https?:|jpeg|base64/i);

    // Survives a restart.
    store = createSqliteStore({ sqlitePath });
    app = createApp(store);
    expect(store.confirmCounts([pick]).get(pick)).toBe(3);
    const after = await ambiguous(app);
    expect(after.body.scan.mapping.candidates[0]?.tcgdexId).toBe(pick);
    expect(Array.isArray(after.body.variantSuggestions)).toBe(true);

    // Account deletion removes the user's log rows.
    await post(app, "/v1/account/delete", {});
    expect(store.listConfirmEvents()).toHaveLength(0);
  });

  it("memory store logs too and leaves order alone with no history", async () => {
    const app = createApp();
    const a = await ambiguous(app);
    const b = await ambiguous(app);
    expect(b.body.scan.mapping.candidates.map((c) => c.tcgdexId)).toEqual(
      a.body.scan.mapping.candidates.map((c) => c.tcgdexId),
    );
  });
});

describe("P1-27 mapping metrics endpoint", () => {
  it("reports confirms, corrections and manual search without user ids", async () => {
    const app = createApp();
    const a = await ambiguous(app);
    const shown = a.body.scan.mapping.candidates.map((c) => c.tcgdexId);
    await post(app, `/v1/scans/${a.body.scan.scanId}/confirm`, { tcgdexId: shown[0] });
    const b = await ambiguous(app);
    await post(app, `/v1/scans/${b.body.scan.scanId}/confirm`, { tcgdexId: "base4-4", via: "manual_search" });
    const res = await app.request("/v1/metrics/mapping?days=7");
    const body = (await res.json()) as { report: { confirms: number; manualSearchRate: number; top1Rate: number } };
    expect(body.report).toMatchObject({ confirms: 2, manualSearchRate: 0.5, top1Rate: 0.5 });
    expect(JSON.stringify(body)).not.toMatch(/userId|user_id/);
    const md = await (await app.request("/v1/metrics/mapping?format=markdown")).text();
    expect(md).toContain("# Mapping quality");
  });
});
