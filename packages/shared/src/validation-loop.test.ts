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
  identifyLiveVideo,
  LIVESTREAM_IDENTIFY_PIPELINE,
  mockLiveVideoFrame,
} from "./live-video-identity";
import { liveOverlayGuessFromSources } from "./live-overlay-guess";
import { buildClipboardExport } from "./listing-draft";
import { mapRecognitionToCatalog } from "./mapper";
import { LOCKED_DISPLAY_CURRENCY } from "./max-buy";
import { identifyCardMock } from "./mock-recognition";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MOCK_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCREENSHOT_APIS =
  /view-shot|captureScreen|capturePage|takeSnapshot|toDataURL|captureRef|ViewShot/i;
const CARDSIGHT_VENDOR_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const PRIVATE_NOTES = "Private: all-in was $4.04. Maybe list on eBay later.";

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function assignmentValues(source: string, key: string): string[] {
  return [...source.matchAll(new RegExp(`(?:^|\\n)${key}=(.*)$`, "gm"))].map(
    (match) => (match[1] ?? "").trim(),
  );
}

describe("Task 28 full loop + flags", () => {
  it("keeps cardflow_card_id, tcgdex_id, and cardsight_card_id as three IDs", async () => {
    const mapping = await mapRecognitionToCatalog(identifyCardMock("high-confidence"));
    expect(mapping.cardsightCardId).toBe(CARDSIGHT_VENDOR_ID);
    expect(mapping.cardflowCardId).toBeNull();
    expect(mapping.tcgdexId).toBe("base1-58");
    expect(mapping.userConfirmation.crmWriteAllowedBeforeConfirm).toBe(false);

    const confirmed = confirmIdentity({
      mapping,
      selectedTcgdexId: "base1-58",
      createId: () => "7c2e1a90-4b3d-4f6a-9c11-2e8f0a1b3c58",
    });
    expect(confirmed.canonicalCard.tcgdexId).toBe("base1-58");
    expect(confirmed.canonicalCard.cardflowCardId).toMatch(MOCK_UUID);
    expect(confirmed.canonicalCard.cardflowCardId).not.toBe(confirmed.canonicalCard.tcgdexId);
    expect(confirmed.canonicalCard.cardflowCardId).not.toBe(mapping.cardsightCardId);
    expect(confirmed.canonicalCard.cardsightCardId).toBe(CARDSIGHT_VENDOR_ID);

    const guess = liveOverlayGuessFromSources({ tcgdexId: "base1-58" });
    expect(guess?.tcgdexId).toBe("base1-58");
    expect(guess?.writesInventory).toBe(false);
    expect(JSON.stringify(guess)).not.toMatch(/cardflowCardId|cardflow_card_id/);
  });

  it("livestream identify is live video, not Capture stills or CardSight", () => {
    const liveIdentify = readRepoFile("apps/mobile/lib/live-identify.ts");
    const scanTab = readRepoFile("apps/mobile/app/(tabs)/scan-tab.tsx");
    const capture = readRepoFile("apps/mobile/app/capture.tsx");
    const overlay = readRepoFile("apps/mobile/components/ui/screener-overlay.tsx");

    expect(LIVESTREAM_IDENTIFY_PIPELINE).toBe("yolo_identity");
    expect(
      identifyLiveVideo({
        scannerOn: true,
        platform: "ios",
        frame: mockLiveVideoFrame("base1-58"),
        classifier: "mock",
      }),
    ).toMatchObject({ tcgdexId: "base1-58", pipeline: LIVESTREAM_IDENTIFY_PIPELINE });
    expect(
      identifyLiveVideo({
        scannerOn: false,
        platform: "ios",
        frame: mockLiveVideoFrame("base1-58"),
        classifier: "mock",
      }).reason,
    ).toBe("scanner_off");

    expect(liveIdentify).toContain("identifyLiveVideo");
    expect(liveIdentify).not.toMatch(SCREENSHOT_APIS);
    expect(liveIdentify).not.toContain("/v1/scans");
    expect(liveIdentify).not.toContain("createScan");
    expect(scanTab).not.toMatch(SCREENSHOT_APIS);
    expect(scanTab).not.toContain("/capture");
    expect(scanTab).not.toContain("createScan");
    expect(scanTab).not.toContain("injectedJavaScript");
    expect(overlay).not.toContain("onScanStill");
    expect(capture).toContain("createScan");
    expect(capture).not.toMatch(/cardsight\.ai|CARDSIGHT_API_KEY/i);
    expect(scanTab).not.toMatch(/cardsight\.ai|CARDSIGHT_API_KEY/i);
    expect(liveIdentify).not.toMatch(/cardsight\.ai|CARDSIGHT_API_KEY/i);
  });

  it("keeps Copy notes omitted, marketplace automation OFF, USD only, no listed/sold", () => {
    expect(FEATURE_FLAG_DEFAULTS.marketplace_automation).toBe(false);
    expect(MARKETPLACE_AUTOMATION_NO_ENABLE_COPY).toContain("no in-app path");
    expect(LOCKED_DISPLAY_CURRENCY).toBe("USD");

    const clipboard = buildClipboardExport({
      title: "Pikachu - Base Set #58 [normal] EN",
      description: "Pikachu — Base Set #58 — English — normal (Raw)",
      condition: "NM",
      askingPrice: "9.00",
      currency: LOCKED_DISPLAY_CURRENCY,
      notes: PRIVATE_NOTES,
      intendedChannelNote: "Maybe list on eBay later",
    });
    expect(clipboard.omittedPrivateNotes).toBe(true);
    expect(clipboard.published).toBe(false);
    expect(clipboard.plainText).toContain("USD");
    expect(clipboard.plainText).not.toContain("Private");
    expect(clipboard.plainText).not.toContain("eBay");

    const migration = readRepoFile("apps/api/drizzle/0000_mvp_crm_schema.sql");
    const schema = readRepoFile("apps/api/src/db/schema.ts");
    expect(schema).toContain("in ('purchased', 'watchlist')");
    expect(migration).not.toMatch(/`listed`/);
    expect(migration).not.toMatch(/`sold`/);
    expect(schema).not.toMatch(/['"]listed['"]|['"]sold['"]/);
  });

  it("does not ship vendor keys or scrape Whatnot/eBay from the app", () => {
    const envExample = readRepoFile("apps/api/.env.example");
    expect(assignmentValues(envExample, "CARDSIGHT_API_KEY")).toEqual([""]);
    expect(assignmentValues(envExample, "CARD_FLOW_POKECOLLECTOR_TOKEN")).toEqual([""]);

    const scanTab = readRepoFile("apps/mobile/app/(tabs)/scan-tab.tsx");
    const livestream = readRepoFile("apps/mobile/lib/livestream.ts");
    expect(livestream).toContain('pageUrl: "https://www.whatnot.com"');
    expect(livestream).toContain('pageUrl: "https://www.ebay.com/ebaylive"');
    expect(scanTab).not.toContain("injectJavaScript");
    expect(scanTab).not.toMatch(/bid|placeBid|scrape/i);
  });
});
