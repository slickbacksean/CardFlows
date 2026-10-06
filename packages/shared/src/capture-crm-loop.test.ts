import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { confirmIdentity } from "./confirm";
import {
  FEATURE_FLAG_DEFAULTS,
  MARKETPLACE_AUTOMATION_NO_ENABLE_COPY,
} from "./feature-flags";
import {
  buildClipboardExport,
  descriptionStarter,
  renderListingTitle,
} from "./listing-draft";
import { mapRecognitionToCatalog } from "./mapper";
import {
  computeMaxBuy,
  DEFAULT_MAX_BUY_PREFERENCES,
  LOCKED_DISPLAY_CURRENCY,
} from "./max-buy";
import { identifyCardMock } from "./mock-recognition";
import { composeMessyCiCardStill, identifyObbPhashBitmap } from "./obb-phash";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PRIVATE_NOTES = "Private: all-in was $4.04. Maybe list on eBay later.";
const PIKACHU = {
  name: "Pikachu",
  setName: "Base Set",
  localId: "58",
  selectedVariant: "normal",
  condition: "NM",
};

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("Task 5 Capture CRM loop wiring", () => {
  it("confirms OBB + pHash identity then Copy omits notes in USD", async () => {
    const messy = composeMessyCiCardStill("base1-58");
    const recognition = await identifyObbPhashBitmap(messy.bitmap, {
      detector: { async detect() { return [messy.box]; } },
    });
    expect(recognition.provider).toBe("obb_phash");
    expect(recognition.detections[0]?.vendorCardId).toBe("base1-58");

    const mapping = await mapRecognitionToCatalog(recognition);
    expect(mapping.tcgdexId).toBe("base1-58");
    expect(mapping.cardsightCardId).toBeNull();
    expect(mapping.userConfirmation.required).toBe(true);
    expect(mapping.userConfirmation.crmWriteAllowedBeforeConfirm).toBe(false);

    const confirmed = confirmIdentity({
      mapping,
      selectedTcgdexId: "base1-58",
      createId: () => "7c2e1a90-4b3d-4f6a-9c11-2e8f0a1b3c58",
    });
    expect(confirmed.confirmationRequiredHonored).toBe(true);
    expect(confirmed.canonicalCard.tcgdexId).toBe("base1-58");
    expect(confirmed.canonicalCard.cardsightCardId).toBeNull();
    expect(confirmed.canonicalCard.mintedOn).toBe("confirm");

    const maxBuy = computeMaxBuy({
      referencePriceAmount: "8.00",
      condition: "NM",
      preferences: DEFAULT_MAX_BUY_PREFERENCES,
    });
    expect(maxBuy.currency).toBe(LOCKED_DISPLAY_CURRENCY);
    expect(maxBuy.maxBuyAmount).toBeTruthy();

    const mockMapping = await mapRecognitionToCatalog(identifyCardMock("high-confidence"));
    expect(mockMapping.userConfirmation.crmWriteAllowedBeforeConfirm).toBe(false);

    const clipboard = buildClipboardExport({
      title: renderListingTitle(PIKACHU),
      description: descriptionStarter(PIKACHU),
      condition: "NM",
      askingPrice: "9.00",
      currency: LOCKED_DISPLAY_CURRENCY,
      notes: PRIVATE_NOTES,
      intendedChannelNote: "Maybe list on eBay later",
    });
    expect(LOCKED_DISPLAY_CURRENCY).toBe("USD");
    expect(clipboard.omittedPrivateNotes).toBe(true);
    expect(clipboard.published).toBe(false);
    expect(clipboard.plainText).toContain("USD");
    expect(clipboard.plainText).not.toContain("Private");
    expect(clipboard.plainText).not.toContain("eBay");
  });

  it("wires Capture still → Confirm → Max Buy → Purchased → draft → Copy without livestream screenshots", () => {
    const capture = readRepoFile("apps/mobile/app/capture.tsx");
    const scan = readRepoFile("apps/mobile/app/scan/[scanId].tsx");
    const decide = readRepoFile("apps/mobile/app/decide/[cardflowCardId].tsx");
    const collection = readRepoFile("apps/mobile/app/(tabs)/collection.tsx");
    const draft = readRepoFile("apps/mobile/app/draft/[draftId].tsx");
    const purchase = readRepoFile("apps/mobile/components/ui/purchase-sheet.tsx");
    const listing = readRepoFile("apps/api/src/listing.ts");
    const api = readRepoFile("apps/api/src/app.ts");
    const index = readRepoFile("apps/api/src/index.ts");
    const recognitionEnv = readRepoFile("apps/api/src/recognition-env.ts");
    const sqlite = readRepoFile("apps/api/src/sqlite-store.ts");
    const scanTab = readRepoFile("apps/mobile/app/(tabs)/scan-tab.tsx");

    expect(capture).toContain("createScan");
    expect(capture).toContain("imageUri");
    expect(capture).toContain("Scan does not create inventory");
    expect(scan).toContain("confirmScan");
    expect(scan).toContain("CONFIRM_SEARCH_MANUALLY_LABEL");
    expect(decide).toContain("computeMaxBuy");
    expect(decide).toContain("savePurchased");
    expect(decide).toContain("canCommitInventory = Boolean(confirmationIdValue)");
    expect(collection).toContain("openOrCreateDraft");
    expect(draft).toContain("getDraftClipboard");
    expect(draft).toContain("Private notes omitted");
    expect(purchase).toContain("LOCKED_DISPLAY_CURRENCY");
    expect(purchase).not.toContain("onChangeText={setCurrency}");
    expect(purchase).not.toMatch(/EUR|JPY/);
    expect(listing).toContain("LOCKED_DISPLAY_CURRENCY");
    expect(listing).toContain("clipboardForDraft");
    expect(listing).toContain("notes: draft.notes");
    expect(api).toContain("currency: LOCKED_DISPLAY_CURRENCY");
    expect(api).not.toContain("body.currency ??");
    expect(index).toContain("liveIdentifyEnabled: recognitionSelection.identifyEnabled");
    expect(recognitionEnv).toContain("isTestEnv(env)");
    expect(recognitionEnv).toContain("CARD_FLOW_OBB_PHASH_ENABLED");
    expect(sqlite).toContain("cardsightCardId: scan.mapping.cardsightCardId");
    expect(sqlite).not.toContain("detections[0]?.vendorCardId");
    expect(scanTab).not.toContain("createScan");
    expect(FEATURE_FLAG_DEFAULTS.marketplace_automation).toBe(false);
    expect(MARKETPLACE_AUTOMATION_NO_ENABLE_COPY).toContain("no in-app path");
  });
});
