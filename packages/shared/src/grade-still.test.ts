import { describe, expect, it } from "vitest";
import {
  GRADE_IMAGE_MAX_BYTES,
  GRADE_STILL_MIN_SHORT_SIDE_PX,
  GRADE_STILL_TOO_SMALL_COPY,
  largestPictureSize,
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
