import { describe, expect, it } from "vitest";
import {
  captureMetaFromExif,
  gradeZoomFromProbe,
  GRADE_CARD_ASPECT,
  gradeAutoCaptureHold,
  gradeCaptureReadiness,
  gradeGuideFrame,
  gradeLevelState,
  tiltFromGravity,
  tiltFromRotation,
} from "./grade-capture-guide";

const DEG = Math.PI / 180;

describe("grade capture guide", () => {
  it("sizes a 63x88 frame to 60-80% of a 3:4 preview", () => {
    const frame = gradeGuideFrame(390, 520);
    expect(frame.width / frame.height).toBeCloseTo(GRADE_CARD_ASPECT, 2);
    expect(frame.height / 520).toBeGreaterThanOrEqual(0.6);
    expect(frame.height / 520).toBeLessThanOrEqual(0.8);
    expect(frame.width / 390).toBeLessThanOrEqual(0.8);
  });

  it("caps the frame width on a wide preview", () => {
    const frame = gradeGuideFrame(300, 900);
    expect(frame.width).toBeLessThanOrEqual(240);
    expect(gradeGuideFrame(0, 0)).toEqual({ width: 0, height: 0 });
  });

  it("measures tilt from rotation and gravity", () => {
    expect(tiltFromRotation(0, 0)?.tiltDeg).toBeCloseTo(0, 5);
    expect(tiltFromRotation(3 * DEG, 0)?.tiltDeg).toBeCloseTo(3, 3);
    expect(tiltFromRotation(0, -1.5 * DEG)?.tiltDeg).toBeCloseTo(1.5, 3);
    expect(tiltFromRotation(Number.NaN, 0)).toBeNull();
    // Screen up on iOS (z < 0) and Android (z > 0) read the same.
    expect(tiltFromGravity(0, 0, -9.81)?.tiltDeg).toBeCloseTo(0, 5);
    expect(tiltFromGravity(0, 0, 9.81)?.tiltDeg).toBeCloseTo(0, 5);
    const g = 9.81;
    expect(tiltFromGravity(g * Math.sin(5 * DEG), 0, g * Math.cos(5 * DEG))?.tiltDeg).toBeCloseTo(5, 3);
  });

  it("uses the cardgrading 2° limit for level", () => {
    expect(gradeLevelState(null)).toBe("unknown");
    expect(gradeLevelState(1.9)).toBe("level");
    expect(gradeLevelState(2)).toBe("level");
    expect(gradeLevelState(4)).toBe("near");
    expect(gradeLevelState(12)).toBe("off");
  });

  it("auto-captures on a level, still pose, and blocks when the card is outside the frame", () => {
    const base = { sensorAvailable: true, level: "level" as const, steady: true };
    expect(gradeCaptureReadiness({ ...base, cardInFrame: null })).toMatchObject({
      ready: true,
      autoCaptureReady: true,
      status: "Looks good",
      tone: "good",
    });
    expect(gradeCaptureReadiness({ ...base, cardInFrame: true }).autoCaptureReady).toBe(true);
    expect(gradeCaptureReadiness({ ...base, cardInFrame: false })).toMatchObject({
      ready: false,
      autoCaptureReady: false,
      status: "Line up the card inside the frame",
    });
    expect(gradeCaptureReadiness({ ...base, level: "near", cardInFrame: true })).toMatchObject({
      ready: false,
      autoCaptureReady: false,
      status: "Hold flat",
      tone: "warn",
    });
    expect(gradeCaptureReadiness({ ...base, sensorAvailable: false, level: "unknown", cardInFrame: null }).tone).toBe(
      "neutral",
    );
    expect(gradeCaptureReadiness({ ...base, steady: false, cardInFrame: null }).autoCaptureReady).toBe(false);
  });

  it("waits out the hold before auto-capture", () => {
    expect(gradeAutoCaptureHold({ autoCaptureReady: true, readySinceMs: 1000, nowMs: 1400 })).toBe(false);
    expect(gradeAutoCaptureHold({ autoCaptureReady: true, readySinceMs: 1000, nowMs: 1500 })).toBe(true);
    expect(gradeAutoCaptureHold({ autoCaptureReady: false, readySinceMs: 1000, nowMs: 5000 })).toBe(false);
    expect(gradeAutoCaptureHold({ autoCaptureReady: true, readySinceMs: null, nowMs: 5000 })).toBe(false);
  });
});

describe("sharp capture helpers", () => {
  it("solves the expo-camera zoom for 2x from one probe", () => {
    // maxZoom 16: probe at 0.1 → 16^0.1 ≈ 1.3195; 2x needs log16(2) = 0.25.
    expect(gradeZoomFromProbe(0.1, 16 ** 0.1, 2)).toBeCloseTo(0.25, 3);
    // maxZoom 123.75 (some iPhone main cameras).
    expect(gradeZoomFromProbe(0.1, 123.75 ** 0.1, 2)).toBeCloseTo(Math.log(2) / Math.log(123.75), 3);
  });

  it("falls back (null) when the probe is unusable or 2x is out of reach", () => {
    expect(gradeZoomFromProbe(0.1, Number.NaN, 2)).toBeNull();
    expect(gradeZoomFromProbe(0.1, 1, 2)).toBeNull();
    expect(gradeZoomFromProbe(0.1, 1.5 ** 0.1, 2)).toBeNull(); // max zoom 1.5x
  });

  it("frames a landscape card at the same physical scale as a portrait one", () => {
    const portrait = gradeGuideFrame(300, 400, 0.55, "portrait");
    const landscape = gradeGuideFrame(300, 400, 0.55, "landscape");
    expect(portrait.height).toBe(220);
    expect(landscape.width).toBe(220);
    expect(landscape.height).toBe(portrait.width);
  });

  it("reads the EXIF fields that explain a soft photo", () => {
    expect(
      captureMetaFromExif({
        DigitalZoomRatio: 2,
        FocalLenIn35mmFilm: 48,
        ExposureTime: 0.0303,
        ISOSpeedRatings: [400],
        LensModel: "iPhone back triple camera 6.86mm f/1.78",
      }),
    ).toEqual({
      digitalZoomRatio: 2,
      focalLength35mm: 48,
      exposureTime: 0.0303,
      iso: 400,
      lensModel: "iPhone back triple camera 6.86mm f/1.78",
    });
    expect(captureMetaFromExif(undefined)).toEqual({});
  });
});
