import { describe, expect, it } from "vitest";
import type { ScanCorrection } from "@cardflow/shared";
import { createApp } from "./app";

type App = ReturnType<typeof createApp>;

async function post<T>(app: App, path: string, body: unknown) {
  const res = await app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

async function highScan(app: App) {
  const scan = await post<{ scan: { scanId: string; mapping: { tcgdexId: string | null } } }>(app, "/v1/scans", {
    captureMethod: "camera_photo",
    scenario: "high-confidence",
  });
  return scan.body.scan;
}

describe("P1-06 manual search corrections", () => {
  it("records a correction when the user picks a different card from search", async () => {
    const corrections: ScanCorrection[] = [];
    const app = createApp(undefined, { scanCorrections: corrections });
    const scan = await highScan(app);
    expect(scan.mapping.tcgdexId).toBeTruthy();
    const confirmed = await post<{ ok: boolean; canonicalCard: { tcgdexId: string } }>(
      app,
      `/v1/scans/${scan.scanId}/confirm`,
      { tcgdexId: "base4-4", via: "manual_search" },
    );
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.canonicalCard.tcgdexId).toBe("base4-4");
    expect(corrections).toHaveLength(1);
    expect(corrections[0]).toMatchObject({
      scanId: scan.scanId,
      via: "manual_search",
      predictedTcgdexId: scan.mapping.tcgdexId,
      chosenTcgdexId: "base4-4",
    });
  });

  it("records nothing for a normal confirm", async () => {
    const corrections: ScanCorrection[] = [];
    const app = createApp(undefined, { scanCorrections: corrections });
    const scan = await highScan(app);
    await post(app, `/v1/scans/${scan.scanId}/confirm`, { tcgdexId: scan.mapping.tcgdexId });
    expect(corrections).toEqual([]);
  });
});
