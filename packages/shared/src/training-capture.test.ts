import { describe, expect, it } from "vitest";
import {
  classifyTrainingLabelSource,
  isTrainingSampleExpired,
  TERMS_SECTIONS,
  TERMS_VERSION,
  TRAINING_CAPTURE_COPY,
  TRAINING_PHOTO_LINE,
  trainingRetentionMonthsFromEnv,
} from "./index";

describe("Sean (Oct 21): training capture rules", () => {
  it("never treats a CardSight answer as the user's own label", () => {
    const shown = ["a", "b"];
    expect(classifyTrainingLabelSource({ recognitionProvider: "cardsight", chosenTcgdexId: "a", shownTcgdexIds: shown })).toBe("cardsight_assisted");
    expect(classifyTrainingLabelSource({ recognitionProvider: "cardsight", via: "manual_search", chosenTcgdexId: "b", shownTcgdexIds: shown })).toBe("cardsight_assisted");
    expect(classifyTrainingLabelSource({ recognitionProvider: "cardsight", via: "manual_search", chosenTcgdexId: "z", shownTcgdexIds: shown })).toBe("manual_search");
    expect(classifyTrainingLabelSource({ recognitionProvider: "obb_phash", chosenTcgdexId: "a", shownTcgdexIds: shown })).toBe("in_house_suggestion");
    expect(classifyTrainingLabelSource({ recognitionProvider: "obb_phash", via: "manual_search", chosenTcgdexId: "a", shownTcgdexIds: shown })).toBe("manual_search");
  });

  it("retention defaults to 12 months and is env-configurable", () => {
    expect(trainingRetentionMonthsFromEnv({})).toBe(12);
    expect(trainingRetentionMonthsFromEnv({ CARD_FLOW_TRAINING_RETENTION_MONTHS: "3" })).toBe(3);
    expect(trainingRetentionMonthsFromEnv({ CARD_FLOW_TRAINING_RETENTION_MONTHS: "nope" })).toBe(12);
    expect(isTrainingSampleExpired("2025-10-20T00:00:00.000Z", new Date("2026-10-21T00:00:00.000Z"), 12)).toBe(true);
    expect(isTrainingSampleExpired("2026-01-01T00:00:00.000Z", new Date("2026-10-21T00:00:00.000Z"), 12)).toBe(false);
  });

  it("the Terms (new version) disclose retention, no sale/sharing, deletion and the Settings opt-out", () => {
    expect(TERMS_VERSION).toBe("2026-10-21.1");
    const text = TERMS_SECTIONS.flatMap((s) => s.paragraphs).join("\n");
    expect(text).toContain(TRAINING_PHOTO_LINE);
    for (const phrase of ["never sold or shared", "12 months", "delete your account", "opt out", "Live Scan video and frames"]) {
      expect(text).toContain(phrase);
    }
    expect(TRAINING_CAPTURE_COPY.settingsLabel).toBe("Help improve card recognition");
    expect(`${TRAINING_PHOTO_LINE} ${Object.values(TRAINING_CAPTURE_COPY).join(" ")}`).not.toMatch(/\bAI\b/);
  });
});
