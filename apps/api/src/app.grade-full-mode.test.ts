import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_INVITED_USER_ID, OUT_OF_FULL_GRADES_CODE, type GradeQuotaSnapshot } from "@cardflow/shared";
import { createApp } from "./app";
import { encodePngStill } from "./obb-phash-decode";

function pngFile(name = "c.png") {
  const data = new Uint8Array(20 * 30 * 3).fill(120);
  return new File([encodePngStill({ data, width: 20, height: 30 })], name, { type: "image/png" });
}

function extraForm(shot = "tilt_a", side = "front") {
  const form = new FormData();
  form.append("image", pngFile());
  form.append("side", side);
  form.append("shot", shot);
  return form;
}

function pregradeForm(fullGrade: boolean) {
  const form = new FormData();
  form.append("front", pngFile("front.png"));
  form.append("back", pngFile("back.png"));
  if (fullGrade) form.append("fullGrade", "true");
  return form;
}

async function quotaOf(app: ReturnType<typeof createApp>) {
  return ((await (await app.request("/v1/grade/quota")).json()) as { quota: GradeQuotaSnapshot }).quota;
}

describe("full 14-photo grade allowance (Sean, Oct 18)", () => {
  const saved = process.env.CARD_FLOW_GRADE_FULL_MODE;
  afterEach(() => {
    if (saved === undefined) delete process.env.CARD_FLOW_GRADE_FULL_MODE;
    else process.env.CARD_FLOW_GRADE_FULL_MODE = saved;
  });

  it("is off without CARD_FLOW_GRADE_FULL_MODE=on", async () => {
    delete process.env.CARD_FLOW_GRADE_FULL_MODE;
    const app = createApp(undefined, { devAutoSession: true, gradeQuota: true, premiumUserIds: [DEFAULT_INVITED_USER_ID] });
    expect((await app.request("/v1/grade/extra", { method: "POST", body: extraForm() })).status).toBe(404);
    expect((await quotaOf(app)).fullGrade).toBeUndefined();
    expect((await app.request("/v1/grade/pregrade", { method: "POST", body: pregradeForm(true) })).status).toBe(400);
  });

  it("free gets 2 full grades a month, separate from the quick estimates, then falls back", async () => {
    process.env.CARD_FLOW_GRADE_FULL_MODE = "on";
    const app = createApp(undefined, { devAutoSession: true, gradeQuota: true, premiumUserIds: [] });
    const before = await quotaOf(app);
    expect(before.fullGrade).toEqual({ monthlyLimit: 2, usedThisMonth: 0, remaining: 2 });

    for (const shot of ["tilt_a", "tilt_b", "corner_tl", "corner_tr", "corner_br", "corner_bl"]) {
      const res = await app.request("/v1/grade/extra", { method: "POST", body: extraForm(shot, "back") });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, side: "back", shot, used: false, stored: false });
    }
    expect((await app.request("/v1/grade/extra", { method: "POST", body: extraForm("flat") })).status).toBe(400);
    // Uploading extras doesn't spend a full grade.
    expect((await quotaOf(app)).fullGrade?.remaining).toBe(2);

    await app.request("/v1/grade/pregrade", { method: "POST", body: pregradeForm(true) });
    await app.request("/v1/grade/pregrade", { method: "POST", body: pregradeForm(true) });
    const after = await quotaOf(app);
    expect(after.fullGrade).toEqual({ monthlyLimit: 2, usedThisMonth: 2, remaining: 0 });
    expect(after.usedThisMonth).toBe(before.usedThisMonth);

    const third = await app.request("/v1/grade/pregrade", { method: "POST", body: pregradeForm(true) });
    expect(third.status).toBe(429);
    expect(await third.json()).toMatchObject({ code: OUT_OF_FULL_GRADES_CODE });
    expect((await app.request("/v1/grade/extra", { method: "POST", body: extraForm() })).status).toBe(429);

    // The quick grade still works and spends the quick allowance.
    const quick = await app.request("/v1/grade/pregrade", { method: "POST", body: pregradeForm(false) });
    expect(quick.status).not.toBe(429);
    expect((await quotaOf(app)).usedThisMonth).toBe(before.usedThisMonth + 1);
  });

  it("Premium gets 25", async () => {
    process.env.CARD_FLOW_GRADE_FULL_MODE = "on";
    const app = createApp(undefined, { devAutoSession: true, gradeQuota: true, premiumUserIds: [DEFAULT_INVITED_USER_ID] });
    expect((await quotaOf(app)).fullGrade).toEqual({ monthlyLimit: 25, usedThisMonth: 0, remaining: 25 });
  });
});
