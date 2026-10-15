import { describe, expect, it } from "vitest";
import { createApp } from "./app";

async function patch(app: ReturnType<typeof createApp>, body: unknown) {
  const res = await app.request("/v1/preferences", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as { preferences?: { targetMarginPct: number; feesBufferPct: number }; error?: string } };
}

describe("P1-13 editable Max Buy rule (D8)", () => {
  it("defaults to 20% / 13%, saves edits per user, and rejects out-of-range values", async () => {
    const app = createApp();
    const initial = await (await app.request("/v1/preferences")).json() as { preferences: { targetMarginPct: number; feesBufferPct: number } };
    expect(initial.preferences).toMatchObject({ targetMarginPct: 0.2, feesBufferPct: 0.13 });
    expect((await patch(app, { targetMarginPct: 0.25, feesBufferPct: 0.1 })).body.preferences).toMatchObject({ targetMarginPct: 0.25, feesBufferPct: 0.1 });
    expect((await patch(app, { targetMarginPct: 0.85 })).status).toBe(400);
    expect((await patch(app, { feesBufferPct: 0.55 })).body.error).toBe("Fees buffer must be between 0 and 50.");
    const after = await (await app.request("/v1/preferences")).json() as { preferences: { targetMarginPct: number } };
    expect(after.preferences.targetMarginPct).toBe(0.25);
  });
});
