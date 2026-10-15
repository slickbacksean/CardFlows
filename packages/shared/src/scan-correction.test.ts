import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CONFIRM_NOT_THIS_CARD_LABEL } from "./confirm-copy";
import { scanCorrectionFor } from "./scan-correction";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("scan corrections (P1-06)", () => {
  const base = { scanId: "s", userId: "u", predictedTcgdexId: "base1-4", candidateTcgdexIds: [] };
  it("only manual-search picks that differ count", () => {
    expect(scanCorrectionFor({ ...base, chosenTcgdexId: "base4-4" })).toBeNull();
    expect(scanCorrectionFor({ ...base, via: "manual_search", chosenTcgdexId: "base1-4" })).toBeNull();
    expect(scanCorrectionFor({ ...base, via: "manual_search", chosenTcgdexId: "base4-4" })?.chosenTcgdexId).toBe(
      "base4-4",
    );
  });

  it("Confirm offers 'Not this card? Search' with name search and tags manual picks", () => {
    expect(CONFIRM_NOT_THIS_CARD_LABEL).toBe("Not this card? Search");
    const scan = readFileSync(path.join(REPO, "apps/mobile/app/scan/[scanId].tsx"), "utf8");
    expect(scan).toContain("CONFIRM_NOT_THIS_CARD_LABEL");
    expect(scan).toContain('accessibilityLabel="Card name"');
    expect(scan).toContain('via: "manual_search"');
  });
});
