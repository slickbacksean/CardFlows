import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mapRecognitionToCatalog } from "./mapper";
import { identifyCardMock } from "./mock-recognition";
import { emptyObbPhashResult } from "./obb-phash";
import { stillIdentifySkippedResult } from "./recognition-flags";
import {
  CONFIRM_AMBIGUOUS_TITLE,
  CONFIRM_COULD_NOT_CONFIRM_MESSAGE,
  CONFIRM_SEARCH_FRAMES,
  CONFIRM_SEARCH_MANUALLY_LABEL,
  CONFIRM_COULD_NOT_IDENTIFY_TITLE,
  confirmFailSoftBody,
  confirmFailSoftTitle,
  confirmFrameFromScan,
  forbiddenConfirmClaim,
} from "./confirm-copy";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("Confirm fail-soft copy", () => {
  it("uses the user-safe search sentence and never claims accuracy", () => {
    expect(CONFIRM_COULD_NOT_CONFIRM_MESSAGE).toBe(
      "We couldn't confirm this card — search by English set and number",
    );
    expect(CONFIRM_SEARCH_MANUALLY_LABEL).toBe("Search manually");
    expect(CONFIRM_COULD_NOT_IDENTIFY_TITLE).toBe("Could not identify");
    expect(confirmFailSoftTitle("no-match")).toBe(CONFIRM_COULD_NOT_IDENTIFY_TITLE);
    expect(CONFIRM_AMBIGUOUS_TITLE).toContain("pick the print");
    expect(forbiddenConfirmClaim(CONFIRM_COULD_NOT_CONFIRM_MESSAGE)).toBeNull();
    expect(forbiddenConfirmClaim(CONFIRM_AMBIGUOUS_TITLE)).toBeNull();
    expect(forbiddenConfirmClaim("CardFlow verified authentic")).toBe("verified_authentic");
    expect(forbiddenConfirmClaim("99% identification accuracy")).toBe("accuracy_claim");
  });

  it("sends no-box, no-hash, and ambiguous to Search manually", () => {
    expect(CONFIRM_SEARCH_FRAMES).toEqual([
      "ambiguous",
      "no-card",
      "no-match",
      "timeout",
      "rate-limit",
    ]);

    expect(
      confirmFrameFromScan({
        recognitionOk: true,
        detectionCount: 0,
        mappingStatus: "no_match",
        hasCanonicalCard: false,
      }),
    ).toBe("no-card");

    expect(
      confirmFrameFromScan({
        recognitionOk: true,
        detectionCount: 1,
        mappingStatus: "no_match",
        hasCanonicalCard: false,
      }),
    ).toBe("no-match");

    expect(
      confirmFrameFromScan({
        recognitionOk: true,
        detectionCount: 1,
        mappingStatus: "ambiguous",
        hasCanonicalCard: false,
      }),
    ).toBe("ambiguous");

    expect(
      confirmFrameFromScan({
        recognitionOk: false,
        recognitionCode: "BAD_REQUEST",
        detectionCount: 0,
        mappingStatus: "catalog_unavailable",
        hasCanonicalCard: false,
      }),
    ).toBe("no-card");

    expect(confirmFailSoftBody("no-card")).toBe(CONFIRM_COULD_NOT_CONFIRM_MESSAGE);
    expect(confirmFailSoftBody("no-match")).toBe(CONFIRM_COULD_NOT_CONFIRM_MESSAGE);
    expect(confirmFailSoftBody("ambiguous")).toBe(CONFIRM_COULD_NOT_CONFIRM_MESSAGE);
  });

  it("maps mock no-card / no-match / ambiguous onto the same Confirm search path", async () => {
    const noCard = await mapRecognitionToCatalog(identifyCardMock("no-card"));
    expect(noCard.status).toBe("no_match");
    expect(noCard.userConfirmation.recommendedUx).toBe(CONFIRM_COULD_NOT_CONFIRM_MESSAGE);
    expect(noCard.userConfirmation.required).toBe(true);

    const noMatch = await mapRecognitionToCatalog(identifyCardMock("no-match"));
    expect(noMatch.status).toBe("no_match");
    expect(noMatch.userConfirmation.recommendedUx).toBe(CONFIRM_COULD_NOT_CONFIRM_MESSAGE);

    const ambiguous = await mapRecognitionToCatalog(identifyCardMock("ambiguous"));
    expect(ambiguous.status).toBe("ambiguous");
    expect(ambiguous.userConfirmation.recommendedUx).toBe(CONFIRM_COULD_NOT_CONFIRM_MESSAGE);
    expect(ambiguous.candidates.length).toBeGreaterThan(1);

    const skipped = await mapRecognitionToCatalog(stillIdentifySkippedResult("missing_image"));
    expect(skipped.userConfirmation.recommendedUx).toBe(CONFIRM_COULD_NOT_CONFIRM_MESSAGE);

    const noBox = await mapRecognitionToCatalog(emptyObbPhashResult());
    expect(noBox.userConfirmation.recommendedUx).toBe(CONFIRM_COULD_NOT_CONFIRM_MESSAGE);
  });

  it("Confirm screen shows the shared copy, picker plus search, and no accuracy claims", () => {
    const screen = readRepoFile("apps/mobile/app/scan/[scanId].tsx");
    expect(screen).toContain("CONFIRM_COULD_NOT_CONFIRM_MESSAGE");
    expect(screen).toContain("CONFIRM_SEARCH_MANUALLY_LABEL");
    expect(screen).toContain("CONFIRM_AMBIGUOUS_TITLE");
    expect(screen).toContain("CONFIRM_SEARCH_FRAMES");
    expect(screen).toContain("MANUAL_SEARCH_FRAMES");
    expect(screen).toContain("confirmFrameFromScan");
    expect(screen).toContain("searchCatalog");
    expect(screen).toContain("AmbiguousConfirm");
    expect(screen).toContain('frame === "no-card"');
    expect(screen).toContain('frame === "no-match"');
    expect(screen).toContain('frame === "ambiguous"');
    expect(forbiddenConfirmClaim(screen)).toBeNull();
    expect(screen).not.toMatch(/verified authentic/i);
    expect(screen).not.toMatch(/\baccurac(?:y|ate|ately)\b/i);
  });
});
