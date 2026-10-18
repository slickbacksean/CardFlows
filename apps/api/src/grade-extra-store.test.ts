import { afterEach, describe, expect, it } from "vitest";
import { utimesSync, existsSync } from "node:fs";
import path from "node:path";
import { encodePngStill } from "./obb-phash-decode";
import {
  checkExtraBlur,
  deleteUserGradeExtras,
  gradeExtrasSessionPath,
  isGradeSessionId,
  laplacianVarianceRgb,
  purgeExpiredGradeExtras,
  saveGradeExtraShot,
} from "./grade-extra-store";
import { GRADED_PHOTO_RETENTION_MS } from "./photo-retention";

function checkerboard(width: number, height: number, cell = 4): Uint8Array {
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const on = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
      const v = on ? 220 : 40;
      const i = (y * width + x) * 3;
      data[i] = data[i + 1] = data[i + 2] = v;
    }
  }
  return data;
}

describe("grade-extra-store", () => {
  const userId = "test-user-extras";
  const sessionId = "gs_test_session_01";
  afterEach(() => {
    deleteUserGradeExtras(userId);
  });

  it("accepts session ids and rejects short ones", () => {
    expect(isGradeSessionId("abcdefgh")).toBe(true);
    expect(isGradeSessionId("short")).toBe(false);
  });

  it("laplacian is high on a checkerboard and near-zero on a flat fill", () => {
    expect(laplacianVarianceRgb(checkerboard(64, 64), 64, 64)).toBeGreaterThan(60);
    expect(laplacianVarianceRgb(new Uint8Array(64 * 64 * 3).fill(120), 64, 64)).toBeLessThan(5);
  });

  it("blur check passes sharp stills and fails flat ones", async () => {
    const sharpPng = encodePngStill({ data: checkerboard(80, 100), width: 80, height: 100 });
    const flatPng = encodePngStill({ data: new Uint8Array(80 * 100 * 3).fill(120), width: 80, height: 100 });
    expect((await checkExtraBlur({ bytes: sharpPng, mimeType: "image/png" })).ok).toBe(true);
    expect((await checkExtraBlur({ bytes: flatPng, mimeType: "image/png" })).ok).toBe(false);
  });

  it("stores extras under user/session", () => {
    const bytes = encodePngStill({ data: checkerboard(40, 50), width: 40, height: 50 });
    expect(
      saveGradeExtraShot({
        userId,
        sessionId,
        side: "front",
        shot: "tilt_a",
        still: { bytes, mimeType: "image/png" },
      }),
    ).toBe(true);
    const dir = gradeExtrasSessionPath(userId, sessionId)!;
    expect(existsSync(path.join(dir, "front-tilt_a.png"))).toBe(true);
  });

  it("purges sessions older than 30 days", () => {
    const bytes = encodePngStill({ data: checkerboard(40, 50), width: 40, height: 50 });
    const oldSession = "gs_old_session_zzz";
    saveGradeExtraShot({
      userId,
      sessionId: oldSession,
      side: "back",
      shot: "corner_tl",
      still: { bytes, mimeType: "image/png" },
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const dir = gradeExtrasSessionPath(userId, oldSession)!;
    const past = new Date(Date.now() - GRADED_PHOTO_RETENTION_MS - 60_000);
    utimesSync(dir, past, past);
    expect(purgeExpiredGradeExtras(new Date()).deleted).toBeGreaterThanOrEqual(1);
    expect(gradeExtrasSessionPath(userId, oldSession)).toBeNull();
  });

  it("deleteUserGradeExtras removes the user tree", () => {
    const bytes = encodePngStill({ data: checkerboard(40, 50), width: 40, height: 50 });
    saveGradeExtraShot({
      userId,
      sessionId,
      side: "front",
      shot: "tilt_b",
      still: { bytes, mimeType: "image/png" },
    });
    expect(deleteUserGradeExtras(userId)).toBeGreaterThanOrEqual(1);
    expect(gradeExtrasSessionPath(userId, sessionId)).toBeNull();
  });
});
