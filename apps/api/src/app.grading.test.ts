import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMockSlabPricingProvider,
  emptySlabEstimate,
  WATCHLIST_CANNOT_SUBMIT_MESSAGE,
} from "@cardflow/shared";
import { createApp } from "./app";
import { createMemoryStore } from "./store";
import { createSqliteStore } from "./sqlite-store";

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
  return { status: response.status, body: (await response.json()) as T };
}

async function confirmPurchased(app: App) {
  const scan = await json<{ scan: { scanId: string } }>(app, "/v1/scans", {
    method: "POST",
    body: JSON.stringify({ captureMethod: "camera_photo", scenario: "high-confidence" }),
  });
  const confirmed = await json<{ confirmation: { confirmationId: string } }>(
    app,
    `/v1/scans/${scan.body.scan.scanId}/confirm`,
    { method: "POST", body: JSON.stringify({ tcgdexId: "base1-58" }) },
  );
  const purchased = await json<{ item: { inventoryItemId: string } }>(app, "/v1/inventory/purchased", {
    method: "POST",
    body: JSON.stringify({
      confirmationId: confirmed.body.confirmation.confirmationId,
      purchasePrice: "4.00",
      purchasedAt: "2026-09-18T00:00:00.000Z",
    }),
  });
  return purchased.body.item.inventoryItemId;
}

describe("durable grading copies", () => {
  it("persists submitted and returned per user without PSA HTTP", async () => {
    const app = createApp(createMemoryStore());
    const inventoryItemId = await confirmPurchased(app);

    const submitted = await json<{
      submitted: Array<{ inventoryItemId: string; estimateJson: string | null }>;
    }>(app, "/v1/grading/submitted", {
      method: "POST",
      body: JSON.stringify({
        intent: "purchased",
        inventoryItemId,
        name: "Pikachu",
        estimateJson: JSON.stringify({ overall: 9, notACert: true }),
      }),
    });
    expect(submitted.status).toBe(200);
    expect(submitted.body.submitted[0]?.inventoryItemId).toBe(inventoryItemId);
    expect(submitted.body.submitted[0]?.estimateJson).toContain("notACert");

    const listed = await json<{
      submitted: Array<{ inventoryItemId: string }>;
      returned: unknown[];
    }>(app, "/v1/grading");
    expect(listed.body.submitted).toHaveLength(1);

    const returned = await json<{
      submitted: unknown[];
      returned: Array<{ certNumber: string; returnedGrade: string }>;
    }>(app, "/v1/grading/returned", {
      method: "POST",
      body: JSON.stringify({
        inventoryItemId,
        certNumber: "123",
        returnedGrade: "9",
      }),
    });
    expect(returned.body.submitted).toHaveLength(0);
    expect(returned.body.returned[0]).toMatchObject({ certNumber: "123", returnedGrade: "9" });
    expect(JSON.stringify(returned.body.returned[0])).not.toContain("notACert");
    expect(JSON.stringify(returned.body)).not.toMatch(/psa\.com|api\.casecomp/i);
  });

  it("blocks watchlist submits and survives a sqlite reopen", async () => {
    const app = createApp(createMemoryStore());
    const blocked = await json<{ error: string }>(app, "/v1/grading/submitted", {
      method: "POST",
      body: JSON.stringify({
        intent: "watchlist",
        inventoryItemId: "inv_watch",
        name: "Pikachu",
      }),
    });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toBe(WATCHLIST_CANNOT_SUBMIT_MESSAGE);

    const first = createSqliteStore({ sqlitePath: ":memory:" });
    const sqliteApp = createApp(first);
    const inventoryItemId = await confirmPurchased(sqliteApp);
    await json(sqliteApp, "/v1/grading/submitted", {
      method: "POST",
      body: JSON.stringify({
        intent: "purchased",
        inventoryItemId,
        name: "Pikachu",
        estimateJson: JSON.stringify({ overall: 8.5, display: "Estimate 8.5", notACert: true }),
      }),
    });
    const after = await json<{
      submitted: Array<{ name: string; estimateJson: string | null; condition: string | null }>;
    }>(sqliteApp, "/v1/grading");
    expect(after.body.submitted[0]?.name).toBe("Pikachu");
    expect(after.body.submitted[0]?.estimateJson).toContain("Estimate 8.5");
    expect(after.body.submitted[0]?.condition).not.toBe("Estimate 8.5");
    first.close();
  });

  it("moves submitted to returned in one transaction and keeps the submitted row if the insert fails", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cardflow-grade-"));
    const sqlitePath = path.join(dir, "cardflow.sqlite");
    const store = createSqliteStore({ sqlitePath });
    try {
      const app = createApp(store);
      const inventoryItemId = await confirmPurchased(app);
      await json(app, "/v1/grading/submitted", {
        method: "POST",
        body: JSON.stringify({
          intent: "purchased",
          inventoryItemId,
          name: "Pikachu",
          estimateJson: JSON.stringify({ overall: 8, display: "Estimate 8", notACert: true }),
        }),
      });
      const raw = new Database(sqlitePath);
      raw.exec(
        "CREATE TRIGGER fail_return BEFORE INSERT ON crm_grading_returned BEGIN SELECT RAISE(ABORT, 'fail insert'); END;",
      );
      raw.close();

      const failed = await json<{ error: string }>(app, "/v1/grading/returned", {
        method: "POST",
        body: JSON.stringify({
          inventoryItemId,
          certNumber: "999",
          returnedGrade: "8",
        }),
      });
      expect(failed.status).toBe(400);

      const stillSubmitted = await json<{
        submitted: Array<{ inventoryItemId: string; estimateJson: string | null }>;
        returned: unknown[];
      }>(app, "/v1/grading");
      expect(stillSubmitted.body.submitted).toHaveLength(1);
      expect(stillSubmitted.body.submitted[0]?.estimateJson).toContain("Estimate 8");
      expect(stillSubmitted.body.returned).toHaveLength(0);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps a returned copy after the store is reopened", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cardflow-grade-"));
    const sqlitePath = path.join(dir, "cardflow.sqlite");
    const first = createSqliteStore({ sqlitePath });
    try {
      const app = createApp(first);
      const inventoryItemId = await confirmPurchased(app);
      await json(app, "/v1/grading/submitted", {
        method: "POST",
        body: JSON.stringify({
          intent: "purchased",
          inventoryItemId,
          name: "Pikachu",
          estimateJson: JSON.stringify({ overall: 8, display: "Estimate 8", notACert: true }),
        }),
      });
      await json(app, "/v1/grading/returned", {
        method: "POST",
        body: JSON.stringify({
          inventoryItemId,
          certNumber: "123",
          returnedGrade: "PSA 9",
        }),
      });
      first.close();
      const second = createSqliteStore({ sqlitePath });
      try {
        const reopened = createApp(second);
        const listed = await json<{
          submitted: unknown[];
          returned: Array<{ returnedGrade: string; certNumber: string }>;
        }>(reopened, "/v1/grading");
        expect(listed.body.submitted).toHaveLength(0);
        expect(listed.body.returned[0]).toMatchObject({
          certNumber: "123",
          returnedGrade: "PSA 9",
        });
      } finally {
        second.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("PokeTrace slab estimates", () => {
  it("returns empty rows when off and mapped rows when mocked", async () => {
    const off = await json<{ estimate: { source: string; rows: unknown[] } }>(
      createApp(createMemoryStore()),
      "/v1/cards/base1-58/slab-estimates",
    );
    expect(off.status).toBe(200);
    expect(off.body.estimate.source).toBe("none");

    const mock = await json<{
      provider: string;
      estimate: { source: string; rows: Array<{ company: string; grade: string; amount: string | null }> };
    }>(createApp(createMemoryStore(), { slabPricing: createMockSlabPricingProvider() }), "/v1/cards/base1-58/slab-estimates");
    expect(mock.body.provider).toBe("mock");
    expect(mock.body.estimate.source).toBe("mock");
    expect(mock.body.estimate.rows.find((row) => row.company === "PSA" && row.grade === "10")?.amount).toBe(
      "120.00",
    );
    expect(JSON.stringify(mock.body)).not.toMatch(/POKETRACE_|X-API-Key/i);
  });

  it("passes catalog name and number into the slab lookup", async () => {
    let seen: { name?: string | null; localId?: string | null; setName?: string | null } | null = null;
    const app = createApp(createMemoryStore(), {
      slabPricing: {
        name: "poketrace",
        async getSlabEstimates(req) {
          seen = req;
          return emptySlabEstimate(req.tcgdexId);
        },
      },
    });
    const result = await json<{ estimate: { tcgdexId: string } }>(app, "/v1/cards/base1-58/slab-estimates");
    expect(result.status).toBe(200);
    expect(seen).toMatchObject({ name: "Pikachu", localId: "58", setName: "Base Set" });
  });
});
