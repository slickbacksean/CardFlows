import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GRADE_STILL_TOO_LARGE_COPY,
  GRADE_UPLOAD_EXPIRED_COPY,
  PREGRADE_COPY,
  PREGRADE_DISCLAIMER,
  PREGRADE_LABEL,
  PHOTO_PREGRADE_SOURCE,
  pregradeCopyViolations,
  PREGRADE_SURFACE_NULL_REASON,
  type DetectCropResult,
  type PhotoPregradeResult,
} from "@cardflow/shared";
import { createGradeUploadCache } from "./grade-image";
import { createApp } from "./app";
import { mapDetectReport, mapGradeCardReport, NOTHING_MEASURED_REASON } from "./cardgrading-map";
import {
  cardgradingChildEnv,
  CARDGRADING_BLANKED_KEYS,
  type CardgradingRunner,
} from "./cardgrading-run";
import { encodePngStill } from "./obb-phash-decode";
import { createCardgradingProvider, pregradePhotoPair, rejectZeroGrade } from "./grade-photo-flow";

const successReport = JSON.parse(
  readFileSync(new URL("./fixtures/cardgrading-success-report.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

function solidPng(width = 20, height = 30) {
  const data = new Uint8Array(width * height * 3).fill(120);
  return encodePngStill({ width, height, data });
}

function pngFile(name: string) {
  return new File([solidPng()], name, { type: "image/png" });
}

function withGate(
  report: Record<string, unknown>,
  side: "front" | "back",
  gate: { name: string; passed: boolean; hard: boolean; detail?: string },
) {
  const copy = structuredClone(report) as {
    capture_quality: Record<string, { gates: Array<Record<string, unknown>> }>;
  };
  const gates = copy.capture_quality[side]!.gates.filter((g) => g.name !== gate.name);
  gates.push({ detail: "", value: null, ...gate });
  copy.capture_quality[side]!.gates = gates;
  return copy;
}

function fakeRunner(
  report: unknown,
  detect: { report: unknown; cropBytes: Buffer | null } = {
    report: { gates: [] },
    cropBytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  },
): CardgradingRunner & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async gradeCard(input) {
      calls.push(`grade ${input.frontExt} ${input.backExt}`);
      if (report instanceof Error) throw report;
      return report;
    },
    async detectCrop(input) {
      calls.push(`detect ${input.photoExt}`);
      return detect;
    },
  };
}

describe("cardgrading mapper (GitHub contract)", () => {
  it("uses grade_estimate.overall_grade as the only estimate and keeps surface null", () => {
    const mapped = mapGradeCardReport(successReport);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.estimate).toBe(8.4);
    expect(mapped.label).toBe(PREGRADE_LABEL);
    expect(mapped.disclaimer).toBe(PREGRADE_DISCLAIMER);
    expect(mapped.subgrades.surface.points).toBeNull();
    expect(mapped.subgrades.surface.reason).toBe(PREGRADE_SURFACE_NULL_REASON);
    expect(JSON.stringify(mapped)).not.toMatch(/overall_grade_rounded|"score"|by_grader/);
  });

  it("is a retake with no number on a hard gate (tilt)", () => {
    const mapped = mapGradeCardReport(
      withGate(successReport, "back", { name: "tilt", passed: false, hard: true }),
    );
    expect(mapped).toEqual({
      ok: false,
      status: "retake",
      code: "PHOTO_RETAKE",
      side: "back",
      reasons: [PREGRADE_COPY.tilted],
    });
    expect("estimate" in mapped).toBe(false);
  });

  it("never shows 0.0 (grade_card's 'nothing measurable') as a grade", () => {
    const mapped = mapGradeCardReport({
      ...successReport,
      grade_estimate: { ...(successReport.grade_estimate as Record<string, unknown>), overall_grade: 0 },
    });
    expect(mapped).toMatchObject({ ok: false, status: "retake", reasons: [NOTHING_MEASURED_REASON] });
    expect("estimate" in mapped).toBe(false);
  });

  it("is a retake when nothing was measured, even if overall_grade is non-zero", () => {
    const mapped = mapGradeCardReport({
      ...successReport,
      subgrades: { front: {}, back: {} },
      centering: { front: {}, back: {} },
      corners_edges: { front: {}, back: {} },
      surface: { front: {}, back: {} },
    });
    expect(mapped).toMatchObject({ ok: false, status: "retake", reasons: [NOTHING_MEASURED_REASON] });
    expect("estimate" in mapped).toBe(false);
  });

  it("strips a scored 0 at the flow boundary so no response can carry it", () => {
    const leaked = rejectZeroGrade({
      ok: true,
      status: "scored",
      label: PREGRADE_LABEL,
      disclaimer: PREGRADE_DISCLAIMER,
      source: PHOTO_PREGRADE_SOURCE,
      estimate: 0,
      subgrades: {
        centering: { points: null, front: null, back: null },
        corners: { points: null, front: null, back: null },
        edges: { points: null, front: null, back: null },
        surface: { points: null, front: null, back: null },
      },
      note: "",
    });
    expect(leaked).toMatchObject({ ok: false, status: "retake", reasons: [NOTHING_MEASURED_REASON] });
    expect("estimate" in leaked).toBe(false);
    expect(JSON.stringify(leaked)).not.toMatch(/\bAI\b|\bPSA\b|\bBGS\b|\bCGC\b/);
  });

  it("reports an undecodable photo as unreadable, not as card not found", () => {
    const mapped = mapDetectReport(
      { ok: false, has_crop: false, gates: [{ name: "card_detection", passed: false, detail: "couldn't decode image", hard: true }] },
      "front",
      null,
    );
    expect(mapped).toMatchObject({ ok: false, status: "retake", reasons: ["Couldn't read the photo"] });
  });

  it("is a retake when both the grade and centering are null", () => {
    const mapped = mapGradeCardReport({ ...successReport, grade_estimate: null, centering: null });
    expect(mapped).toMatchObject({ ok: false, status: "retake", reasons: ["Card not found"] });
  });

  it("still scores on a soft gate (glare) with a warning", () => {
    const mapped = mapGradeCardReport(
      withGate(successReport, "front", { name: "glare", passed: false, hard: false }),
    );
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.estimate).toBe(8.4);
    expect(mapped.warning).toBe("Front: Glare on the card.");
  });

  it("plain-words notes: surface not assessed from one photo, size not checked, no jargon", () => {
    const mapped = mapGradeCardReport(successReport);
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) return;
    expect(mapped.subgrades.surface.reason).toBe("Surface not assessed from a single photo.");
    expect(mapped.note).toBe("Surface isn't part of this estimate. Card size isn't checked from photos.");
    expect(mapped.angled).toEqual({ provided: 0, used: 0, status: "not_provided" });
    const text = JSON.stringify(mapped);
    expect(text).not.toMatch(/dpi|relief|single-image|psa|tag|cgc/i);
    expect(pregradeCopyViolations(text)).toEqual([]);
  });

  it("is a retake 'Photo is blurry' on the sharpness gate, and 'move closer' on capture scale", () => {
    const blurry = mapGradeCardReport(
      withGate(successReport, "front", { name: "sharpness", passed: false, hard: true, detail: "laplacian variance=45.8" }),
    );
    expect(blurry).toMatchObject({ ok: false, status: "retake", side: "front", reasons: [PREGRADE_COPY.blurry] });
    const far = mapGradeCardReport(
      withGate(successReport, "back", { name: "capture_scale", passed: false, hard: true, detail: "effective dpi=220" }),
    );
    expect(far).toMatchObject({ ok: false, status: "retake", side: "back", reasons: [PREGRADE_COPY.tooFar] });
    const small = mapGradeCardReport(
      withGate(successReport, "back", { name: "capture_scale_low", passed: false, hard: false }),
    );
    expect(small).toMatchObject({ ok: true, warning: "Back: Card is small in the photo." });
  });

  it("never shows a library detail string for an unknown hard gate", () => {
    const mapped = mapGradeCardReport(
      withGate(successReport, "front", { name: "mystery", passed: false, hard: true, detail: "max corner angle deviation=3.1 deg" }),
    );
    expect(mapped).toMatchObject({ ok: false, reasons: [PREGRADE_COPY.unusable] });
  });

  it("grades surface only when the adapter accepted the raking-light photos", () => {
    const withSurface = {
      ...successReport,
      subgrades: {
        front: { ...(successReport.subgrades as { front: object }).front, surface: 7 },
        back: (successReport.subgrades as { back: object }).back,
      },
    };
    const notAccepted = mapGradeCardReport({
      ...withSurface,
      cardflow: { angled: { provided: 4, used: 4, status: "no_light_change" } },
    });
    expect(notAccepted.ok && notAccepted.subgrades.surface).toMatchObject({
      points: null,
      front: null,
      reason: PREGRADE_COPY.surfaceAngledNoLight,
    });
    const accepted = mapGradeCardReport({
      ...withSurface,
      cardflow: {
        angled: { provided: 4, used: 4, status: "graded" },
        capture: { front: { sharpness: 240.5, effective_dpi: 810.2 }, back: { sharpness: 210, effective_dpi: 790 } },
      },
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.subgrades.surface).toEqual({
      points: 70,
      front: 7,
      back: null,
      reason: PREGRADE_COPY.surfaceNotAssessedBack,
    });
    expect(accepted.note).toContain(PREGRADE_COPY.surfaceIncludedNote);
    expect(accepted.capture).toEqual({
      front: { sharpness: 240.5, effectiveDpi: 810.2 },
      back: { sharpness: 210, effectiveDpi: 790 },
    });
  });

  it("detect: a blurry photo is a retake with its measurements attached", () => {
    const mapped = mapDetectReport(
      {
        ok: false,
        gates: [
          { name: "card_detection", passed: true, hard: true },
          { name: "sharpness", passed: false, hard: true, detail: "laplacian variance=20.2" },
        ],
        cardflow_capture: { sharpness: 20.2, effective_dpi: 553.3 },
      },
      "front",
      Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    );
    expect(mapped).toMatchObject({
      ok: false,
      status: "retake",
      reasons: [PREGRADE_COPY.blurry],
      capture: { sharpness: 20.2, effectiveDpi: 553.3 },
    });
  });
});

describe("cardgrading runner env", () => {
  it("blanks every model key and drops other API secrets in the child env", () => {
    const env = cardgradingChildEnv({
      PATH: "/usr/bin",
      XAI_API_KEY: "xai-should-not-pass",
      ANTHROPIC_API_KEY: "sk-ant-should-not-pass",
      GEMINI_API_KEY: "g",
      POKETRACE_API_KEY: "pt",
    });
    for (const key of CARDGRADING_BLANKED_KEYS) expect(env[key]).toBe("");
    expect(env.POKETRACE_API_KEY).toBeUndefined();
    expect(JSON.stringify(env)).not.toMatch(/should-not-pass/);
  });
});

describe("grade photo flow", () => {
  it("turns a library 0.0 into a retake and never returns estimate 0", async () => {
    const still = { bytes: solidPng(), mimeType: "image/png" as const };
    const zeroed = {
      ...successReport,
      grade_estimate: { ...(successReport.grade_estimate as Record<string, unknown>), overall_grade: 0.0 },
    };
    const result = await pregradePhotoPair({ runner: fakeRunner(zeroed), front: still, back: still });
    expect(result).toMatchObject({ ok: false, status: "retake", reasons: [NOTHING_MEASURED_REASON] });
    expect("estimate" in result).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/\bAI\b|\bPSA\b|\bBGS\b|\bCGC\b/);
  });

  it("is unavailable, never a number, when the grader is missing or crashes", async () => {
    const still = { bytes: solidPng(), mimeType: "image/png" as const };
    const missing = await pregradePhotoPair({ runner: null, front: still, back: still });
    expect(missing).toMatchObject({ ok: false, status: "unavailable" });
    const crashed = await pregradePhotoPair({
      runner: fakeRunner(new Error("boom")),
      front: still,
      back: still,
    });
    expect(crashed).toMatchObject({ ok: false, status: "unavailable" });
    expect("estimate" in crashed).toBe(false);
  });

  it("returns a crop with soft warnings, and a retake on a hard detect gate", async () => {
    const found = createApp(undefined, {
      cardgrading: fakeRunner(successReport, {
        report: {
          gates: [
            { name: "card_detection", passed: true, hard: true },
            { name: "uneven_lighting", passed: false, hard: false },
          ],
        },
        cropBytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      }),
    });
    const form = new FormData();
    form.append("image", pngFile("front.png"));
    form.append("side", "back");
    const res = await found.request("/v1/grade/detect", { method: "POST", body: form });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DetectCropResult;
    expect(body).toMatchObject({ ok: true, status: "found", side: "back", warnings: [PREGRADE_COPY.unevenLight] });
    if (body.ok) expect(body.crop.mimeType).toBe("image/jpeg");

    const miss = createApp(undefined, {
      cardgrading: fakeRunner(successReport, {
        report: { gates: [{ name: "card_detection", passed: false, hard: true }] },
        cropBytes: null,
      }),
    });
    const missForm = new FormData();
    missForm.append("image", pngFile("front.png"));
    const missRes = await miss.request("/v1/grade/detect", { method: "POST", body: missForm });
    expect(await missRes.json()).toMatchObject({
      ok: false,
      status: "retake",
      side: "front",
      reasons: ["Card not found"],
    });
  });

  it("pregrades both original photos and labels it a pre-grade estimate, not a cert", async () => {
    const runner = fakeRunner(successReport);
    const app = createApp(undefined, { cardgrading: runner });
    const form = new FormData();
    form.append("front", pngFile("front.png"));
    form.append("back", pngFile("back.png"));
    const res = await app.request("/v1/grade/pregrade", { method: "POST", body: form });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PhotoPregradeResult;
    expect(runner.calls).toEqual(["grade .png .png"]);
    expect(body).toMatchObject({
      ok: true,
      status: "scored",
      estimate: 8.4,
      label: "Pre-grade estimate",
      disclaimer: "Estimate only. Not an official grade.",
    });
  });

  it("answers unavailable on the Grade tab when no grader is configured", async () => {
    const app = createApp();
    const form = new FormData();
    form.append("front", pngFile("front.png"));
    form.append("back", pngFile("back.png"));
    const res = await app.request("/v1/grade/pregrade", { method: "POST", body: form });
    expect(await res.json()).toMatchObject({ ok: false, status: "unavailable" });
  });

  it("Prepare provider: overall from overall_grade, retake has no number, crash throws", async () => {
    const img = { bytes: solidPng(), byteLength: 1, mimeType: "image/png" };
    const scored = await createCardgradingProvider(fakeRunner(successReport)).estimateGrade({
      frontImage: img,
      backImage: img,
    });
    expect(scored.overall).toBe(8.4);
    expect(scored.display).toBe("Pre-grade 8.4");
    expect(scored.subgrades.find((r) => r.id === "surface" && r.side === "front")?.score).toBeNull();

    const retake = await createCardgradingProvider(
      fakeRunner(withGate(successReport, "front", { name: "aspect_ratio", passed: false, hard: true })),
    ).estimateGrade({ frontImage: img, backImage: img });
    expect(retake.overall).toBeNull();
    expect(retake.display).toContain(PREGRADE_COPY.shapeOff);

    const needsBack = await createCardgradingProvider(fakeRunner(successReport)).estimateGrade({
      frontImage: img,
      backImage: null,
    });
    expect(needsBack.overall).toBeNull();

    await expect(
      createCardgradingProvider(fakeRunner(new Error("boom"))).estimateGrade({
        frontImage: img,
        backImage: img,
      }),
    ).rejects.toThrow();
  });

  it("blocks duplicate in-flight submits so a double-tap runs the grader once", async () => {
    let calls = 0;
    let release!: () => void;
    const hold = new Promise<void>((r) => {
      release = r;
    });
    let began!: () => void;
    const started = new Promise<void>((r) => {
      began = r;
    });
    const runner = fakeRunner(successReport);
    const original = runner.gradeCard.bind(runner);
    runner.gradeCard = async (input) => {
      calls += 1;
      began();
      await hold;
      return original(input);
    };
    const still = { bytes: solidPng(), mimeType: "image/png" as const };
    const first = pregradePhotoPair({ runner, front: still, back: still });
    const second = pregradePhotoPair({ runner, front: still, back: still });
    await started;
    expect(calls).toBe(1);
    release();
    const results = await Promise.all([first, second]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]?.ok).toBe(true);
    if (results[0]?.ok) expect(results[0].estimate).toBe(8.4);

    const sequential = await pregradePhotoPair({ runner, front: still, back: still });
    expect(calls).toBe(2);
    expect(sequential.ok).toBe(true);
  });
});

function jpegSof(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
  ]);
}

describe("P0-02 single upload and header size reject", () => {
  it("rejects an oversized JPEG from the header and never runs the grader", async () => {
    const runner = fakeRunner(successReport);
    const app = createApp(undefined, { cardgrading: runner, gradeUploads: createGradeUploadCache() });
    const form = new FormData();
    form.append("image", new File([jpegSof(8000, 6000)], "huge.jpg", { type: "image/jpeg" }));
    const res = await app.request("/v1/grade/detect", { method: "POST", body: form });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: GRADE_STILL_TOO_LARGE_COPY });
    expect(runner.calls).toEqual([]);
  });

  it("pregrades from detect upload ids without a second photo upload", async () => {
    const runner = fakeRunner(successReport);
    const app = createApp(undefined, { cardgrading: runner, gradeUploads: createGradeUploadCache() });
    const frontForm = new FormData();
    frontForm.append("image", pngFile("front.png"));
    frontForm.append("side", "front");
    const frontRes = await app.request("/v1/grade/detect", { method: "POST", body: frontForm });
    const front = (await frontRes.json()) as DetectCropResult & { uploadId?: string };
    expect(front).toMatchObject({ ok: true, uploadId: expect.any(String) });

    const backForm = new FormData();
    backForm.append("image", pngFile("back.png"));
    backForm.append("side", "back");
    const backRes = await app.request("/v1/grade/detect", { method: "POST", body: backForm });
    const back = (await backRes.json()) as DetectCropResult & { uploadId?: string };
    expect(back).toMatchObject({ ok: true, uploadId: expect.any(String) });

    const grade = new FormData();
    grade.append("frontUploadId", front.uploadId ?? "");
    grade.append("backUploadId", back.uploadId ?? "");
    const scored = await app.request("/v1/grade/pregrade", { method: "POST", body: grade });
    expect(scored.status).toBe(200);
    expect(await scored.json()).toMatchObject({
      ok: true,
      status: "scored",
      estimate: 8.4,
      label: "Pre-grade estimate",
    });
    expect(runner.calls).toEqual(["detect .png", "detect .png", "grade .png .png"]);

    const retry = new FormData();
    retry.append("frontUploadId", front.uploadId ?? "");
    retry.append("backUploadId", back.uploadId ?? "");
    const expired = await app.request("/v1/grade/pregrade", { method: "POST", body: retry });
    expect(expired.status).toBe(400);
    expect(await expired.json()).toMatchObject({ ok: false, error: GRADE_UPLOAD_EXPIRED_COPY });
  });

  it("rejects a stale upload id with a retake, not a grader call", async () => {
    const runner = fakeRunner(successReport);
    const app = createApp(undefined, { cardgrading: runner, gradeUploads: createGradeUploadCache() });
    const grade = new FormData();
    grade.append("frontUploadId", "11111111-1111-1111-1111-111111111111");
    grade.append("backUploadId", "22222222-2222-2222-2222-222222222222");
    const res = await app.request("/v1/grade/pregrade", { method: "POST", body: grade });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: GRADE_UPLOAD_EXPIRED_COPY });
    expect(runner.calls).toEqual([]);
  });
});
