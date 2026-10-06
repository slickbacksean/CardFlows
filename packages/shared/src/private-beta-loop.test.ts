import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { computeAllInCost } from "./all-in-cost";
import { confirmIdentity } from "./confirm";
import {
  FEATURE_FLAG_DEFAULTS,
  MARKETPLACE_AUTOMATION_NO_ENABLE_COPY,
  SETTINGS_RESEARCH_FLAGS,
  featureFlagStateLabel,
} from "./feature-flags";
import { DEFAULT_INVITED_USER_ID, INVITED_USERS } from "./identity";
import {
  buildClipboardExport,
  descriptionStarter,
  renderListingTitle,
} from "./listing-draft";
import { mapRecognitionToCatalog } from "./mapper";
import {
  DEFAULT_MAX_BUY_PREFERENCES,
  computeMaxBuy,
  recomputeCopyMaxBuy,
} from "./max-buy";
import { identifyCardMock } from "./mock-recognition";
import type { MaxBuyPreferences } from "./types";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const PIKACHU = {
  name: "Pikachu",
  setName: "Base Set",
  localId: "58",
  selectedVariant: "normal",
  condition: "NM",
};

const PRIVATE_NOTES = "Private: all-in was $4.04. Maybe list on eBay later.";

async function runActiveUserLoop(preferences: MaxBuyPreferences) {
  const mapping = await mapRecognitionToCatalog(identifyCardMock("high-confidence"));
  expect(mapping.cardflowCardId).toBeNull();
  expect(mapping.userConfirmation.required).toBe(true);
  expect(mapping.userConfirmation.crmWriteAllowedBeforeConfirm).toBe(false);

  const confirmed = confirmIdentity({
    mapping,
    selectedTcgdexId: "base1-58",
    createId: () => "7c2e1a90-4b3d-4f6a-9c11-2e8f0a1b3c58",
  });
  expect(confirmed.confirmationRequiredHonored).toBe(true);
  expect(confirmed.canonicalCard.mintedOn).toBe("confirm");
  expect(confirmed.canonicalCard.cardflowCardId).toBe(
    "7c2e1a90-4b3d-4f6a-9c11-2e8f0a1b3c58",
  );

  const maxBuy = computeMaxBuy({
    referencePriceAmount: "8.00",
    condition: "NM",
    preferences,
  });
  expect(maxBuy.maxBuyAmount).toBeTruthy();
  expect(maxBuy.disclaimer).toContain("not a market price");

  const allIn = computeAllInCost({ purchasePrice: "4.00", shipping: "0.04" });
  expect(allIn.allInTotal).toBe("4.04");

  const clipboard = buildClipboardExport({
    title: renderListingTitle(PIKACHU),
    description: descriptionStarter(PIKACHU),
    condition: "NM",
    askingPrice: "9.00",
    currency: "USD",
    notes: PRIVATE_NOTES,
    intendedChannelNote: "Maybe list on eBay later",
  });
  expect(clipboard.omittedPrivateNotes).toBe(true);
  expect(clipboard.plainText).not.toContain("Private");
  expect(clipboard.plainText).not.toContain("eBay");
  expect(clipboard.published).toBe(false);

  return { mapping, confirmed, maxBuy, clipboard };
}

describe("Private-beta loop as the active invited user", () => {
  it("completes scan → confirm → Max Buy → Purchased/draft → Copy", async () => {
    const alex = await runActiveUserLoop(DEFAULT_MAX_BUY_PREFERENCES);
    expect(alex.maxBuy.maxBuyAmount).toBe("5.57");
    expect(DEFAULT_INVITED_USER_ID).toBe(INVITED_USERS[0].userId);
  });

  it("still honors Confirm-before-inventory and Copy-omits-notes after switch + Max Buy save", async () => {
    const tighter: MaxBuyPreferences = {
      ...DEFAULT_MAX_BUY_PREFERENCES,
      targetMarginPct: 0.3,
    };
    const alex = await runActiveUserLoop(tighter);
    const jordan = await runActiveUserLoop(DEFAULT_MAX_BUY_PREFERENCES);

    expect(alex.maxBuy.maxBuyAmount).toBe("4.87");
    expect(jordan.maxBuy.maxBuyAmount).toBe("5.57");
    expect(
      recomputeCopyMaxBuy(
        { referencePriceAmount: "8.00", condition: "NM" },
        tighter,
      ).maxBuyAmount,
    ).toBe(alex.maxBuy.maxBuyAmount);

    expect(alex.mapping.userConfirmation.crmWriteAllowedBeforeConfirm).toBe(false);
    expect(jordan.mapping.userConfirmation.crmWriteAllowedBeforeConfirm).toBe(false);
    expect(alex.clipboard.omittedPrivateNotes).toBe(true);
    expect(jordan.clipboard.omittedPrivateNotes).toBe(true);
  });

  it("wires the HTTP loop to the active invited user without scan-alone inventory", () => {
    const api = readRepoFile("apps/api/src/app.ts");
    const store = readRepoFile("apps/api/src/store.ts");
    const capture = readRepoFile("apps/mobile/app/capture.tsx");
    const scan = readRepoFile("apps/mobile/app/scan/[scanId].tsx");
    const decide = readRepoFile("apps/mobile/app/decide/[cardflowCardId].tsx");
    const listing = readRepoFile("apps/api/src/listing.ts");
    const draft = readRepoFile("apps/mobile/app/draft/[draftId].tsx");

    expect(api).toContain("c.get(\"userId\")");
    expect(api).toContain("cardflowCardId: null");
    expect(api).toContain("inventoryItemId: null");
    expect(api).toContain("preInventoryState: \"scan_captured\"");
    expect(api).toContain("identifyLiveCaptureStill");
    expect(readRepoFile("apps/api/src/scan-card-name.ts")).toContain("fallback.identifyCard");
    expect(api).toContain("await mapRecognitionToCatalog(recognition, catalog)");
    expect(api).toContain("Confirm the card before Purchased");
    expect(api).toContain("Confirm the card before Watchlist");
    expect(api).toContain("getConfirmation(userId, body.confirmationId)");
    expect(api).toContain("clipboardForDraft(draft)");
    expect(api).toContain("pricingProvider:");
    expect(api).toContain("pricingProviderHealth(pricing.name)");
    expect(api).toContain("recognitionHealth(recognitionProvider.name)");
    expect(api).toContain("livestreamIdentify");
    expect(api).toContain("gradeEstimate:");
    expect(api).toContain("gradeEstimateHealth(gradingProvider.name)");

    expect(store).toContain("scan.userId !== userId");
    expect(store).toContain("item.userId === userId");
    expect(store).not.toContain("store.activeUserId");

    expect(capture).toContain("createScan");
    expect(capture).toContain("Scan does not create inventory");
    expect(scan).toContain("confirmScan");
    expect(scan).toContain("confirmationId: result.confirmation.confirmationId");
    expect(scan).toContain("searchCatalog");
    expect(scan).toContain("CONFIRM_SEARCH_MANUALLY_LABEL");
    expect(scan).toContain("CONFIRM_COULD_NOT_CONFIRM_MESSAGE");
    expect(scan).toContain("MANUAL_SEARCH_FRAMES");
    expect(api).toContain("/v1/catalog/search");
    expect(api).toContain("searchCatalog(");
    expect(decide).toContain("canCommitInventory = Boolean(confirmationIdValue)");
    expect(decide).toContain("if (!confirmationIdValue) return");
    expect(decide).toContain("savePurchased");
    expect(decide).toContain("saveWatchlist");
    expect(decide).toContain("computeMaxBuy");

    expect(listing).toContain("userId: input.item.userId");
    expect(listing).toContain("buildClipboardExport");
    expect(listing).toContain("notes: draft.notes");
    expect(draft).toContain("getDraftClipboard");
    expect(draft).toContain("Private notes omitted");
  });

  it("does not let account switch or Max Buy save mint inventory or copy notes", () => {
    const api = readRepoFile("apps/api/src/app.ts");
    const identity = readRepoFile("apps/mobile/lib/identity.ts");
    const preferences = readRepoFile("apps/mobile/lib/preferences.ts");

    const createSession = api.slice(
      api.indexOf('app.post("/v1/sessions"'),
      api.indexOf('app.get("/v1/identity"'),
    );
    const patchIdentity = api.slice(
      api.indexOf('app.patch("/v1/identity"'),
      api.indexOf('app.get("/v1/preferences"'),
    );
    const patchPrefs = api.slice(
      api.indexOf('app.patch("/v1/preferences"'),
      api.indexOf('app.post("/v1/max-buy"'),
    );

    expect(createSession).toContain("identityForInviteCode(body.inviteCode)");
    expect(createSession).not.toContain("confirmScan");
    expect(createSession).not.toContain("saveInventoryItem");
    expect(createSession).not.toContain("cardflowCardId");
    expect(patchIdentity).toContain("identityForInviteCode(body.inviteCode)");
    expect(patchIdentity).not.toContain("confirmScan");
    expect(patchIdentity).not.toContain("saveInventoryItem");
    expect(patchPrefs).toContain("setPreferences(userId, next)");
    expect(patchPrefs).not.toContain("confirmScan");
    expect(patchPrefs).not.toContain("saveInventoryItem");
    expect(patchPrefs).not.toContain("saveDraft");

    expect(identity).toContain("createSession(inviteCode)");
    expect(identity).not.toContain("confirmScan");
    expect(identity).not.toContain("savePurchased");
    expect(preferences).toContain("patchPreferences");
    expect(preferences).not.toContain("savePurchased");
    expect(preferences).not.toContain("getDraftClipboard");
  });
});

describe("Research flags stay OFF after the identity slice", () => {
  it("keeps research, pricing, and marketplace automation OFF with no enable path", () => {
    const pricingProviderEnabled: false = FEATURE_FLAG_DEFAULTS.pricing_provider_enabled;
    const marketplaceAutomation: false = FEATURE_FLAG_DEFAULTS.marketplace_automation;
    expect(FEATURE_FLAG_DEFAULTS.live_identification_research).toBe(false);
    expect(FEATURE_FLAG_DEFAULTS.live_browser_research).toBe(false);
    expect(FEATURE_FLAG_DEFAULTS.auto_scan_research).toBe(false);
    expect(pricingProviderEnabled).toBe(false);
    expect(marketplaceAutomation).toBe(false);

    for (const flag of SETTINGS_RESEARCH_FLAGS) {
      expect(flag.enabled).toBe(false);
      expect(featureFlagStateLabel(flag.enabled)).toBe("OFF");
    }
    expect(MARKETPLACE_AUTOMATION_NO_ENABLE_COPY).toContain("no in-app path");

    const settings = readRepoFile("apps/mobile/app/settings.tsx");
    expect(settings).toContain("SETTINGS_RESEARCH_FLAGS.map");
    expect(settings).toContain("SETTINGS_STACK_STATUS_ROWS.map");
    expect(settings).toContain("getHealth()");
    expect(settings).toContain("pointerEvents=\"none\"");
    expect(settings).toContain("MARKETPLACE_AUTOMATION_NO_ENABLE_COPY");
    expect(settings).not.toMatch(/<Switch[\s/>]/);
    expect(settings).not.toContain('accessibilityRole="switch"');
    expect(settings).not.toContain("TextInput");
    expect(settings).not.toMatch(/api[_ -]?key/i);
  });
});
