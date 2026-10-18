import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_INVITED_USER_ID, OUT_OF_FULL_GRADES_CODE, type GradeQuotaSnapshot } from "@cardflow/shared";
import { createApp } from "./app";
import { encodePngStill } from "./obb-phash-decode";
import { deleteUserGradeExtras } from "./grade-extra-store";

function checkerboard(width: number, height: number): Uint8Array {
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const on = (Math.floor(x / 3) + Math.floor(y / 3)) % 2 === 0;
      const v = on ? 230 : 30;
      const i = (y * width + x) * 3;
      data[i] = data[i + 1] = data[i + 2] = v;
    }
  }
  return data;
}

function pngFile(name = "c.png") {
  return new File([encodePngStill({ data: checkerboard(64, 80), width: 64, height: 80 })], name, {
    type: "image/png",
  });
}

function flatPngFile(name = "flat.png") {
  const data = new Uint8Array(64 * 80 * 3).fill(120);
  return new File([encodePngStill({ data, width: 64, height: 80 })], name, { type: "image/png" });
}

function extraForm(shot = "tilt_a", side = "front", sessionId = "gs_full_mode_test1") {
  const form = new FormData();
  form.append("image", pngFile());
  form.append("side", side);
  form.append("shot", shot);
  form.append("sessionId", sessionId);
  return form;
}

function pregradeForm(fullGrade: boolean, sessionId?: string) {
  const form = new FormData();
  form.append("front", pngFile("front.png"));
  form.append("back", pngFile("back.png"));
  if (fullGrade) form.append("fullGrade", "true");
  if (sessionId) form.append("sessionId", sessionId);
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
    deleteUserGradeExtras(DEFAULT_INVITED_USER_ID);
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

    const sessionId = "gs_full_mode_test1";
    for (const shot of ["tilt_a", "tilt_b", "corner_tl", "corner_tr", "corner_br", "corner_bl"]) {
      const res = await app.request("/v1/grade/extra", { method: "POST", body: extraForm(shot, "back", sessionId) });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        ok: true,
        side: "back",
        shot,
        sessionId,
        used: false,
        stored: true,
      });
    }
    expect((await app.request("/v1/grade/extra", { method: "POST", body: extraForm("flat") })).status).toBe(400);
    expect((await quotaOf(app)).fullGrade?.remaining).toBe(2);

    await app.request("/v1/grade/pregrade", { method: "POST", body: pregradeForm(true, sessionId) });
    await app.request("/v1/grade/pregrade", { method: "POST", body: pregradeForm(true, sessionId) });
    const after = await quotaOf(app);
    expect(after.fullGrade).toEqual({ monthlyLimit: 2, usedThisMonth: 2, remaining: 0 });
    expect(after.usedThisMonth).toBe(before.usedThisMonth);

    const third = await app.request("/v1/grade/pregrade", { method: "POST", body: pregradeForm(true, sessionId) });
    expect(third.status).toBe(429);
    expect(await third.json()).toMatchObject({ code: OUT_OF_FULL_GRADES_CODE });
    expect((await app.request("/v1/grade/extra", { method: "POST", body: extraForm() })).status).toBe(429);

    const quick = await app.request("/v1/grade/pregrade", { method: "POST", body: pregradeForm(false) });
    expect(quick.status).not.toBe(429);
    expect((await quotaOf(app)).usedThisMonth).toBe(before.usedThisMonth + 1);
  });

  it("rejects blurry extras with a retake", async () => {
    process.env.CARD_FLOW_GRADE_FULL_MODE = "on";
    const app = createApp(undefined, { devAutoSession: true, gradeQuota: true, premiumUserIds: [] });
    const form = new FormData();
    form.append("image", flatPngFile());
    form.append("side", "front");
    form.append("shot", "tilt_a");
    form.append("sessionId", "gs_blur_test_0001");
    const res = await app.request("/v1/grade/extra", { method: "POST", body: form });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false, status: "retake", code: "PHOTO_RETAKE" });
  });

  it("Premium gets 25", async () => {
    process.env.CARD_FLOW_GRADE_FULL_MODE = "on";
    const app = createApp(undefined, { devAutoSession: true, gradeQuota: true, premiumUserIds: [DEFAULT_INVITED_USER_ID] });
    expect((await quotaOf(app)).fullGrade).toEqual({ monthlyLimit: 25, usedThisMonth: 0, remaining: 25 });
  });
});
