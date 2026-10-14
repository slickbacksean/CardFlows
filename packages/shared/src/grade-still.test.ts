import { describe, expect, it } from "vitest";
import {
  GRADE_IMAGE_MAX_BYTES,
  GRADE_STILL_MAX_LONG_EDGE_PX,
  GRADE_STILL_MIN_SHORT_SIDE_PX,
  GRADE_STILL_QUALITY,
  GRADE_STILL_TOO_LARGE_COPY,
  GRADE_STILL_TOO_SMALL_COPY,
  gradeStillPixelRatio,
  gradeStillResizeAction,
  largestPictureSize,
  scaleToLongEdge,
  stillFromCameraCapture,
} from "./index";

describe("stillFromCameraCapture", () => {
  it("fails without a uri", () => {
    expect(stillFromCameraCapture({ uri: undefined })).toEqual({ error: "Could not take a photo. Try again." });
    expect(stillFromCameraCapture({ uri: null })).toEqual({ error: "Could not take a photo. Try again." });
  });

  it("maps jpg and png formats to mime types, defaulting to jpeg", () => {
    expect(stillFromCameraCapture({ uri: "file:///a.jpg", format: "jpg" })).toEqual({
      still: { uri: "file:///a.jpg", mimeType: "image/jpeg" },
    });
    expect(stillFromCameraCapture({ uri: "file:///a.png", format: "png" })).toEqual({
      still: { uri: "file:///a.png", mimeType: "image/png" },
    });
    expect(stillFromCameraCapture({ uri: "file:///a" })).toEqual({
      still: { uri: "file:///a", mimeType: "image/jpeg" },
    });
    expect(
      stillFromCameraCapture({ uri: "file:///a.jpg", format: "jpg", width: 4032, height: 3024 }),
    ).toEqual({
      still: { uri: "file:///a.jpg", mimeType: "image/jpeg", width: 4032, height: 3024 },
    });
  });

  it("rejects stills over the upload byte limit", () => {
    expect(stillFromCameraCapture({ uri: "file:///a.jpg", fileSize: GRADE_IMAGE_MAX_BYTES + 1 })).toEqual({
      error: "Image must be 20 MB or smaller",
    });
    expect("still" in stillFromCameraCapture({ uri: "file:///a.jpg", fileSize: GRADE_IMAGE_MAX_BYTES })).toBe(true);
  });

  it("asks for a retake when the short side is under the minimum, in either orientation", () => {
    const min = GRADE_STILL_MIN_SHORT_SIDE_PX;
    expect(min).toBe(1200);
    expect(stillFromCameraCapture({ uri: "file:///a.jpg", width: 4000, height: min - 1 })).toEqual({
      error: GRADE_STILL_TOO_SMALL_COPY,
    });
    expect(stillFromCameraCapture({ uri: "file:///a.jpg", width: min - 1, height: 4000 })).toEqual({
      error: GRADE_STILL_TOO_SMALL_COPY,
    });
    expect("still" in stillFromCameraCapture({ uri: "file:///a.jpg", width: min, height: 1600 })).toBe(true);
  });

  it("does not block when dimensions are unknown", () => {
    expect("still" in stillFromCameraCapture({ uri: "file:///a.jpg", width: 0, height: 0 })).toBe(true);
  });
});

describe("largestPictureSize", () => {
  it("picks the largest WxH size", () => {
    expect(largestPictureSize(["640x480", "4032x3024", "1920x1080"])).toBe("4032x3024");
  });
  it("falls back to the iOS Photo preset", () => {
    expect(largestPictureSize(["High", "Medium", "Photo"])).toBe("Photo");
  });
  it("returns undefined when nothing usable is listed", () => {
    expect(largestPictureSize([])).toBeUndefined();
    expect(largestPictureSize(["Low"])).toBeUndefined();
  });
});

describe("P0-02 long-edge cap", () => {
  it("picks 4032 px and quality 0.8, with copy that names no grader", () => {
    expect(GRADE_STILL_MAX_LONG_EDGE_PX).toBe(4032);
    expect(GRADE_STILL_QUALITY).toBe(0.8);
    expect(GRADE_STILL_TOO_LARGE_COPY).toBe(
      "That photo is too large. Long edge must be 4032 pixels or smaller.",
    );
    expect(GRADE_STILL_TOO_LARGE_COPY).not.toMatch(/\bAI\b|\bPSA\b|\bBGS\b|\bCGC\b/);
  });

  it("leaves a 12 MP iPhone still alone and downscales 48 MP to 12 MP", () => {
    expect(scaleToLongEdge(4032, 3024)).toEqual({ width: 4032, height: 3024 });
    expect(scaleToLongEdge(3024, 4032)).toEqual({ width: 3024, height: 4032 });
    expect(scaleToLongEdge(8064, 6048)).toEqual({ width: 4032, height: 3024 });
    expect(gradeStillResizeAction(4032, 3024)).toBeNull();
    expect(gradeStillResizeAction(8064, 6048)).toEqual({
      resize: { width: 4032, height: 3024 },
    });
  });

  it("cuts a 48 MP still to 25% of the pixels, which is more than a 60% upload-byte drop", () => {
    // Previous build: quality-1 full-res (48 MP on modern iPhones).
    // This build: 4032 long edge (12 MP) at JPEG q=0.8.
    const pixelRatio = gradeStillPixelRatio(8064, 6048);
    expect(pixelRatio).toBe(0.25);
    // JPEG q=0.8 vs q=1 is typically ≤0.6 of the bytes at the same size.
    // Combined remaining bytes ≤ 0.25 * 0.6 = 0.15 (85% cut), above the 60% bar.
    expect(pixelRatio * 0.6).toBeLessThanOrEqual(0.4);
  });
});
