import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PREGRADE_DISCLAIMER,
  PREGRADE_LABEL,
  PREGRADE_SURFACE_NULL_REASON,
  type DetectCropResult,
  type PhotoPregradeResult,
} from "@cardflow/shared";
import { createApp } from "./app";
import { mapGradeCardReport } from "./cardgrading-map";
import {
  cardgradingChildEnv,
  CARDGRADING_BLANKED_KEYS,
  type CardgradingRunner,
} from "./cardgrading-run";
import { encodePngStill } from "./obb-phash-decode";
import { createCardgradingProvider, pregradePhotoPair } from "./grade-photo-flow";

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
      reasons: ["Camera angle too tilted"],
    });
    expect("estimate" in mapped).toBe(false);
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
    expect(mapped.warning).toBe("Front: Glare detected");
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
    expect(body).toMatchObject({ ok: true, status: "found", side: "back", warnings: ["Uneven lighting"] });
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

  it("pregrades both original photos and labels it an AI pre-grade, not a cert", async () => {
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
      label: "AI pre-grade estimate",
      disclaimer: "Not an official PSA, BGS, or CGC grade.",
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
    expect(scored.display).toBe("AI pre-grade 8.4");
    expect(scored.subgrades.find((r) => r.id === "surface" && r.side === "front")?.score).toBeNull();

    const retake = await createCardgradingProvider(
      fakeRunner(withGate(successReport, "front", { name: "aspect_ratio", passed: false, hard: true })),
    ).estimateGrade({ frontImage: img, backImage: img });
    expect(retake.overall).toBeNull();
    expect(retake.display).toContain("Unexpected aspect ratio");

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
});
