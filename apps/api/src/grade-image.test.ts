import { describe, expect, it } from "vitest";
import {
  gradeImageStorageCandidates,
  gradeImageStorageRef,
  isFirstPartyGradeImageRef,
  isGradePhotoSide,
  mimeFromGradeStorageRef,
  safeGradeInventoryId,
} from "./grade-image";

describe("first-party grade photo keys", () => {
  it("builds a first-party object key and never a catalog or vendor URL", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const ref = gradeImageStorageRef(id, "back", "image/jpeg");
    expect(ref).toBe(`grade/${id}-back.jpg`);
    expect(isFirstPartyGradeImageRef(ref)).toBe(true);
    expect(mimeFromGradeStorageRef(ref)).toBe("image/jpeg");
    expect(isGradePhotoSide("front")).toBe(true);
    expect(isGradePhotoSide("side")).toBe(false);
    expect(isFirstPartyGradeImageRef("https://assets.tcgdex.net/en/base/base1/58/high.webp")).toBe(
      false,
    );
    expect(isFirstPartyGradeImageRef("https://api.casecomp.xyz/grade")).toBe(false);
    expect(isFirstPartyGradeImageRef(`scans/${id}.jpg`)).toBe(false);
  });

  it("sanitizes inventory ids so paths stay under grade/", () => {
    expect(safeGradeInventoryId("pc:purchased:12")).toBe("pc_purchased_12");
    expect(safeGradeInventoryId("../etc/passwd")).toBe(".._etc_passwd");
    expect(gradeImageStorageCandidates("pc:purchased:12", "front")).toEqual([
      "grade/pc_purchased_12-front.jpg",
      "grade/pc_purchased_12-front.png",
      "grade/pc_purchased_12-front.webp",
    ]);
  });
});
