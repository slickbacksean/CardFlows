import { describe, expect, it } from "vitest";
import { parseScanCreateFormFields, parseScanCreateJson, scanImageMimeSchema } from "./scan-request";

describe("scan create Zod validation", () => {
  it("accepts captureMethod and scenario and rejects extra JSON fields", () => {
    expect(parseScanCreateJson({ captureMethod: "manual_scan", scenario: "ambiguous" })).toEqual({
      captureMethod: "manual_scan",
      scenario: "ambiguous",
      image: null,
    });
    expect(parseScanCreateJson({})).toEqual({
      captureMethod: "camera_photo",
      scenario: "high-confidence",
      image: null,
    });
    expect(parseScanCreateJson({ captureMethod: "camera_photo", scenario: "high-confidence", apiKey: "secret" })).toEqual({
      error: "Unexpected field",
      status: 400,
    });
    expect(parseScanCreateJson({ image: "not-allowed-on-json" })).toEqual({
      error: "Unexpected field",
      status: 400,
    });
  });

  it("rejects extra multipart fields and keeps the image allowlist", () => {
    expect(
      parseScanCreateFormFields({
        captureMethod: "camera_photo",
        scenario: "no-card",
        image: "file",
      }),
    ).toMatchObject({
      captureMethod: "camera_photo",
      scenario: "no-card",
      image: "file",
    });
    expect(
      parseScanCreateFormFields({
        captureMethod: "camera_photo",
        scenario: "high-confidence",
        image: "file",
        "X-API-Key": "secret",
      }),
    ).toEqual({ error: "Unexpected field", status: 400 });
    expect(scanImageMimeSchema.safeParse("image/jpeg").success).toBe(true);
    expect(scanImageMimeSchema.safeParse("image/gif").success).toBe(false);
  });
});
