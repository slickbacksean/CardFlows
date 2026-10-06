import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmIdentity } from "./confirm";
import {
  FEATURE_FLAG_DEFAULTS,
  MARKETPLACE_AUTOMATION_NO_ENABLE_COPY,
} from "./feature-flags";
import {
  GRADE_ESTIMATE_ENABLED_FLAG,
  GRADE_ESTIMATE_EMPTY_COPY,
  GRADE_PHOTOS_HINT,
  GRADING_TAB_CONSTRAINT,
  mockCardGradingProvider,
} from "./grade-estimate";
import {
  canMovePurchasedCopyToSubmitted,
  markSubmittedCopyReturned,
  movePurchasedCopyToSubmitted,
  WATCHLIST_CANNOT_SUBMIT_MESSAGE,
} from "./grading";
import { DEFAULT_INVITED_USER_ID } from "./identity";
import {
  buildClipboardExport,
  descriptionStarter,
  renderListingTitle,
} from "./listing-draft";
import { mapRecognitionToCatalog } from "./mapper";
import { LOCKED_DISPLAY_CURRENCY } from "./max-buy";
import { identifyCardMock } from "./mock-recognition";
import { PREPARE_SLAB_ROWS } from "./slab-pricing";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SCREENSHOT_APIS =
  /view-shot|captureScreen|capturePage|takeSnapshot|toDataURL|captureRef|ViewShot/i;
const PRIVATE_NOTES = "Private: all-in was $4.04. Maybe list on eBay later.";
const PIKACHU = {
  name: "Pikachu",
  setName: "Base Set",
  localId: "58",
  selectedVariant: "normal",
  condition: "NM",
} as const;

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function jpeg() {
  return { byteLength: 12, mimeType: "image/jpeg" as const };
}

function assignmentValues(source: string, key: string): string[] {
  return [...source.matchAll(new RegExp(`(?:^|\\n)${key}=(.*)$`, "gm"))].map(
    (match) => (match[1] ?? "").trim(),
  );
}

describe("Task 8 grading Prepare loop", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("completes confirm → Prepare estimate → Submitted → typed Returned without rewriting condition", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("Prepare loop must not call the network");
    });

    const mapping = await mapRecognitionToCatalog(identifyCardMock("high-confidence"));
    expect(mapping.userConfirmation.crmWriteAllowedBeforeConfirm).toBe(false);

    const confirmed = confirmIdentity({
      mapping,
      selectedTcgdexId: "base1-58",
      createId: () => "7c2e1a90-4b3d-4f6a-9c11-2e8f0a1b3c58",
    });
    expect(confirmed.confirmationRequiredHonored).toBe(true);

    const empty = await mockCardGradingProvider.estimateGrade({
      frontImage: null,
      backImage: null,
    });
    expect(empty.overall).toBeNull();
    expect(empty.notACert).toBe(true);
    expect(empty.display).toBe("No estimate");

    const estimate = await mockCardGradingProvider.estimateGrade({
      frontImage: jpeg(),
      backImage: jpeg(),
      mimeType: "image/jpeg",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockCardGradingProvider.name).toBe("mock");
    expect(estimate.overall).not.toBeNull();
    expect(estimate.notACert).toBe(true);
    expect(estimate.label).toBe("estimate");
    expect(estimate.display).not.toBe(PIKACHU.condition);

    expect(canMovePurchasedCopyToSubmitted("purchased")).toBe(true);
    expect(() =>
      movePurchasedCopyToSubmitted([], {
        userId: DEFAULT_INVITED_USER_ID,
        intent: "watchlist",
        inventoryItemId: "inv_watch",
        name: PIKACHU.name,
      }),
    ).toThrow(WATCHLIST_CANNOT_SUBMIT_MESSAGE);

    const submitted = movePurchasedCopyToSubmitted([], {
      userId: DEFAULT_INVITED_USER_ID,
      intent: "purchased",
      inventoryItemId: "inv_1",
      name: PIKACHU.name,
      localId: PIKACHU.localId,
      condition: PIKACHU.condition,
      estimateJson: JSON.stringify(estimate),
      submittedAt: "2026-09-18T00:00:00.000Z",
    });
    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.condition).toBe("NM");
    expect(submitted[0]?.estimateJson).toContain(estimate.display);
    expect(submitted[0]?.condition).not.toBe(estimate.display);
    expect(submitted[0]).not.toHaveProperty("overall");
    expect(submitted[0]).not.toHaveProperty("subgrades");

    const typedGrade = "PSA 9";
    expect(typedGrade).not.toBe(estimate.display);
    expect(typedGrade).not.toBe(String(estimate.overall));

    const next = markSubmittedCopyReturned(submitted, [], {
      inventoryItemId: "inv_1",
      certNumber: " 12345678 ",
      returnedGrade: ` ${typedGrade} `,
      returnedAt: "2026-09-18T02:00:00.000Z",
    });
    expect(next.returned[0]?.certNumber).toBe("12345678");
    expect(next.returned[0]?.returnedGrade).toBe(typedGrade);
    expect(next.returned[0]).not.toHaveProperty("overall");
    expect(next.returned[0]?.returnedGrade).not.toBe(estimate.display);

    const clipboard = buildClipboardExport({
      title: renderListingTitle(PIKACHU),
      description: descriptionStarter(PIKACHU),
      condition: PIKACHU.condition,
      askingPrice: "9.00",
      currency: LOCKED_DISPLAY_CURRENCY,
      notes: PRIVATE_NOTES,
      intendedChannelNote: "Maybe list on eBay later",
    });
    expect(LOCKED_DISPLAY_CURRENCY).toBe("USD");
    expect(clipboard.omittedPrivateNotes).toBe(true);
    expect(clipboard.published).toBe(false);
    expect(clipboard.plainText).toContain("USD");
    expect(clipboard.plainText).toContain("NM");
    expect(clipboard.plainText).not.toContain("Private");
    expect(clipboard.plainText).not.toContain("eBay");
    expect(clipboard.plainText).not.toContain(estimate.display);
    expect(FEATURE_FLAG_DEFAULTS.marketplace_automation).toBe(false);
    expect(MARKETPLACE_AUTOMATION_NO_ENABLE_COPY).toContain("no in-app path");
  });

  it("shows fail-soft slab rows on Prepare and never screenshots livestream or overwrites returned grade", () => {
    const prepare = readRepoFile("apps/mobile/components/ui/prepare-sheet.tsx");
    const grading = readRepoFile("apps/mobile/app/(tabs)/grading.tsx");
    const submittedSheet = readRepoFile("apps/mobile/components/ui/submitted-sheet.tsx");
    const returned = readRepoFile("apps/mobile/components/ui/returned-sheet.tsx");
    const scanTab = readRepoFile("apps/mobile/app/(tabs)/scan-tab.tsx");
    const liveIdentify = readRepoFile("apps/mobile/lib/live-identify.ts");

    expect(GRADING_TAB_CONSTRAINT).toBe("AI pre-grade estimate, not a cert.");
    expect(GRADE_ESTIMATE_EMPTY_COPY).toBe("No photo estimate yet.");
    expect(GRADE_PHOTOS_HINT.toLowerCase()).toContain("still submit");
    expect(PREPARE_SLAB_ROWS.length).toBeGreaterThan(0);

    expect(grading).toContain("GRADING_TAB_CONSTRAINT");
    expect(grading).toContain("condition: payload.condition");
    expect(grading).toContain("estimateJson: payload.estimateJson");
    expect(grading).toContain("parseStoredGradeEstimate(copy.estimateJson)");
    expect(grading).toContain("returnedGrade: payload.returnedGrade");
    expect(grading).toContain("listGrading");
    expect(grading).toContain("submitGradingCopy");
    expect(grading).toContain("setActionError");
    expect(grading).not.toContain(".catch(() => {})");
    expect(grading).not.toMatch(/condition:\s*[^=\n]*estimate/i);
    expect(grading).not.toMatch(/returnedGrade:\s*[^=\n]*estimate/i);
    expect(grading).not.toContain("PREPARE_SLAB_ROWS");
    expect(grading).not.toMatch(/POKETRACE_|slabEstimatesFromPoketracePrices/i);

    expect(prepare).toContain("GRADE_ESTIMATE_EMPTY_COPY");
    expect(prepare).toContain("GRADE_ESTIMATE_UNAVAILABLE_COPY");
    expect(prepare).toContain("requestGradeEstimate");
    expect(prepare).toContain('label="Re-estimate"');
    expect(prepare).toContain("reestimate: true");
    expect(prepare).toContain("serializeGradeEstimate(gradeEstimate)");
    expect(prepare).toContain("getSlabEstimates");
    expect(prepare).toContain("SLAB_PRICE_EMPTY_COPY");
    expect(prepare).toContain("rawRowLabel");
    expect(prepare).toContain("Raw estimate");
    expect(prepare).toContain("disabled={!canSubmit}");
    expect(prepare).not.toMatch(/POKETRACE_|X-API-Key/i);
    expect(prepare).not.toMatch(SCREENSHOT_APIS);
    expect(prepare).not.toContain("identifyLiveVideo");
    expect(prepare).not.toContain("/v1/livestream");

    expect(submittedSheet).toContain("GRADE_ESTIMATE_GUIDANCE_HISTORY_LABEL");
    expect(submittedSheet).toContain("parseStoredGradeEstimate");
    expect(submittedSheet).toContain("GRADE_ESTIMATE_EMPTY_COPY");
    expect(submittedSheet).not.toContain("condition:");
    expect(submittedSheet).not.toContain("returnedGrade");
    expect(submittedSheet).not.toContain("requestGradeEstimate");

    expect(returned).toContain("You type the cert # and returned grade");
    expect(returned).toContain('accessibilityLabel="Returned condition or grade"');
    expect(returned).not.toContain("requestGradeEstimate");
    expect(returned).not.toContain("emptyGradeEstimate");
    expect(returned).not.toMatch(/overall|subgrades|poketrace/i);

    expect(scanTab).not.toContain("PrepareSheet");
    expect(scanTab).not.toMatch(SCREENSHOT_APIS);
    expect(liveIdentify).not.toContain("PrepareSheet");
    expect(liveIdentify).not.toMatch(SCREENSHOT_APIS);
  });

  it("keeps CI on mocks with keys off the phone and no vendor source in the tree", () => {
    const envExample = readRepoFile("apps/api/.env.example");
    const settings = readRepoFile("apps/mobile/app/settings.tsx");
    const mobileApi = readRepoFile("apps/mobile/lib/api.ts");

    expect(mockCardGradingProvider.name).toBe("mock");
    expect(GRADE_ESTIMATE_ENABLED_FLAG in FEATURE_FLAG_DEFAULTS).toBe(false);
    expect(process.env.XAI_API_KEY ?? "").toBe("");
    expect(process.env.ANTHROPIC_API_KEY ?? "").toBe("");
    expect(process.env.POKETRACE_API_KEY ?? "").toBe("");
    expect(assignmentValues(envExample, "XAI_API_KEY")).toEqual([]);
    expect(assignmentValues(envExample, "POKETRACE_API_KEY")).toEqual([""]);
    expect(assignmentValues(envExample, "CARD_FLOW_GRADE_ESTIMATE_ENABLED")).toEqual([""]);
    expect(assignmentValues(envExample, "CARD_FLOW_PSA_GRADE_URL")).toEqual([""]);
    expect(assignmentValues(envExample, "CARD_FLOW_PSA_GRADE_TOKEN")).toEqual([""]);

    expect(settings).not.toMatch(/ANTHROPIC_|anthropic|XAI_|AI grading|poketrace|PSA_GRADE/i);
    expect(settings).not.toContain("TextInput");
    expect(mobileApi).not.toMatch(/ANTHROPIC_|XAI_|api\.anthropic|api\.x\.ai|api\.casecomp|POKETRACE_|PSA_GRADE/i);

    expect(existsSync(path.join(repoRoot, "casecomp"))).toBe(false);
    expect(existsSync(path.join(repoRoot, "tcg-oracle-app"))).toBe(false);
    expect(existsSync(path.join(repoRoot, "apps/api/src/lib/grading"))).toBe(false);
  });
});
