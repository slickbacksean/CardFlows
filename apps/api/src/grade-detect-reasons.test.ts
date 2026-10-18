import { describe, expect, it } from "vitest";
import { PREGRADE_COPY } from "@cardflow/shared";
import { mapDetectReport } from "./cardgrading-map";
import { detectLogLine } from "./grade-photo-flow";

const gate = (name: string, passed: boolean, value: number | null = null) => ({ name, passed, value, hard: true, detail: "x" });

describe("detect retake reasons", () => {
  it("says blurry first when blur also broke the outline", () => {
    const mapped = mapDetectReport(
      { ok: false, gates: [gate("card_detection", true), gate("tilt", false, 9.2), gate("sharpness", false, 2)] },
      "front",
      null,
    );
    expect(mapped).toMatchObject({ ok: false, reasons: [PREGRADE_COPY.blurry, PREGRADE_COPY.tilted] });
  });

  it("suggests a darker background when a sharp photo's outline was missed", () => {
    const notFound = mapDetectReport({ ok: false, gates: [gate("card_detection", false)] }, "front", null);
    expect(notFound).toMatchObject({ reasons: [PREGRADE_COPY.notFound, PREGRADE_COPY.darkerBackground] });
    const shape = mapDetectReport({ ok: false, gates: [gate("card_detection", true), gate("aspect_ratio", false, 18)] }, "back", null);
    expect(shape).toMatchObject({ reasons: [PREGRADE_COPY.shapeOff, PREGRADE_COPY.darkerBackground] });
  });

  it("logs one line with no image data", () => {
    const report = {
      ok: false,
      image_size: [4032, 3024],
      detect_method: "edge",
      cardflow_capture: { sharpness: 41.234 },
      gates: [gate("card_detection", true), gate("tilt", true, 1.61), gate("aspect_ratio", true, 0.36), gate("sharpness", false, 41.2)],
    };
    const mapped = mapDetectReport(report, "front", null);
    expect(detectLogLine(report, mapped, 812)).toBe(
      "grade-detect side=front found=false method=edge size=4032x3024 sharpness=41.2 tilt=1.6 aspect=0.4 fails=sharpness ms=812",
    );
  });
});
