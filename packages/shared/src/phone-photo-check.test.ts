import { describe, expect, it } from "vitest";
import { GRADE_FRAME_FILL, gradeGuideFrame } from "./grade-capture-guide";
import { PREGRADE_COPY } from "./pregrade-copy";
import { gradeProbeDetail, phonePhotoCheck, type GrayImage } from "./phone-photo-check";

const W = 192;
const H = 256;

/** A card lined up in the guide frame with some printed texture. */
function cardPhoto(opts: { offsetX?: number; scale?: number; noise?: number } = {}): GrayImage {
  const data = new Uint8Array(W * H).fill(30);
  const frame = gradeGuideFrame(W, H, GRADE_FRAME_FILL.zoomed * (opts.scale ?? 1));
  const left = Math.round((W - frame.width) / 2) + (opts.offsetX ?? 0);
  const top = Math.round((H - frame.height) / 2);
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    const inside = x >= left && x < left + frame.width && y >= top && y < top + frame.height;
    let v = inside ? 200 : 30;
    if (inside) v += ((x >> 2) + (y >> 2)) % 2 === 0 ? 40 : -40; // printed pattern
    v += (rand() - 0.5) * (opts.noise ?? 10);
    data[y * W + x] = Math.max(0, Math.min(255, Math.round(v)));
  }
  return { width: W, height: H, data };
}

function boxBlur(img: GrayImage, passes: number): GrayImage {
  let src = img.data;
  for (let p = 0; p < passes; p += 1) {
    const out = new Uint8Array(src.length);
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
      let s = 0, n = 0;
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < H && xx >= 0 && xx < W) { s += src[yy * W + xx]!; n += 1; }
      }
      out[y * W + x] = Math.round(s / n);
    }
    src = out;
  }
  return { width: W, height: H, data: src };
}

describe("P1-16 on-phone photo check", () => {
  it("passes a sharp card lined up in the frame", () => {
    const r = phonePhotoCheck(cardPhoto());
    expect(r).toMatchObject({ ok: true, reasons: [] });
    expect(r.cornersWithEdges).toBe(4);
  });

  it("tolerates small misalignment and size differences (no false flags)", () => {
    for (const offsetX of [-6, 0, 6]) for (const scale of [0.9, 1, 1.1]) {
      expect(phonePhotoCheck(cardPhoto({ offsetX, scale })).ok).toBe(true);
    }
  });

  it("flags a blurry photo with the shared copy", () => {
    const r = phonePhotoCheck(boxBlur(cardPhoto({ noise: 0 }), 4));
    expect(r.reasons).toContain(PREGRADE_COPY.blurry);
  });

  it("auto-capture probe: a blurry still is flagged blurry (move back), never a corner hit", () => {
    const blurry = gradeProbeDetail(boxBlur(cardPhoto({ noise: 0 }), 4));
    expect(blurry).toMatchObject({ corners: 0, blurry: true });
    expect(blurry.sharpness).toBeGreaterThanOrEqual(0);
    expect(gradeProbeDetail(cardPhoto()).blurry).toBe(false);
  });

  it("flags a card that isn't in the frame", () => {
    const r = phonePhotoCheck(cardPhoto({ scale: 0.45 }));
    expect(r.reasons).toContain(PREGRADE_COPY.shapeOff);
  });

  it("says card not found on a blank photo", () => {
    const r = phonePhotoCheck({ width: W, height: H, data: new Uint8Array(W * H).fill(90) });
    expect(r.reasons).toEqual([PREGRADE_COPY.notFound]);
  });
});

describe("P1-16 phone wiring", () => {
  it("runs in Expo Go (manipulator + pure-JS JPEG decode) and keeps a 'Check anyway' path", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = dirname(fileURLToPath(import.meta.url));
    const lib = readFileSync(resolve(here, "../../../apps/mobile/lib/phone-photo-check.ts"), "utf8");
    expect(lib).toMatch(/expo-image-manipulator/);
    expect(lib).toMatch(/from "jpeg-js"/);
    expect(lib).not.toMatch(/requireNativeModule|NativeModules/);
    const flow = readFileSync(resolve(here, "../../../apps/mobile/components/ui/photo-grade-flow.tsx"), "utf8");
    expect(flow).toContain("checkGradeStillOnPhone");
    expect(flow).toContain("PHONE_CHECK_COPY.checkAnyway");
  });
});
