import jpeg from "jpeg-js";
import { describe, expect, it } from "vitest";
import { composeMessyCiCardStill } from "@cardflow/shared";
import { locateLiveVideoCard } from "./live-video-obb";

function encodeJpeg(width: number, height: number, rgb: Uint8Array): string {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = rgb[i * 3] ?? 0;
    rgba[i * 4 + 1] = rgb[i * 3 + 1] ?? 0;
    rgba[i * 4 + 2] = rgb[i * 3 + 2] ?? 0;
    rgba[i * 4 + 3] = 255;
  }
  return jpeg.encode({ data: rgba, width, height }, 80).data.toString("base64");
}

describe("locateLiveVideoCard", () => {
  it("returns an AABB crop and 4 OBB corners for warp.py", async () => {
    const messy = composeMessyCiCardStill("base1-58");
    const frame = encodeJpeg(messy.bitmap.width, messy.bitmap.height, messy.bitmap.data);
    const located = await locateLiveVideoCard(
      { async detect() { return [messy.box]; } },
      frame,
    );
    expect(located?.found).toBe(true);
    if (!located?.found) return;
    expect(located.identityCropQuad).toHaveLength(8);
    expect(located.identityHash).toMatch(/^[01]{105}$/);
    expect(located.jpegBase64.length).toBeGreaterThan(32);
  });

  it("reports no card when YOLO is empty", async () => {
    const messy = composeMessyCiCardStill("base1-4");
    const frame = encodeJpeg(messy.bitmap.width, messy.bitmap.height, messy.bitmap.data);
    const located = await locateLiveVideoCard({ async detect() { return []; } }, frame);
    expect(located).toEqual({ found: false });
  });
});
