import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { computeMaxBuy } from "./max-buy";
import { identifyCardMock } from "./mock-recognition";
import { mockCardRecognitionProvider } from "./recognition";
import { mapRecognitionToCatalog } from "./mapper";
import {
  buildClipboardExport,
  computeCostToAskSpread,
  renderListingTitle,
} from "./listing-draft";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");

function readFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as Record<
    string,
    unknown
  >;
}

describe("fixtures", () => {
  const files = readdirSync(fixturesDir).filter((name) => name.endsWith(".json"));

  it("marks every JSON fixture as mocked", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const fixture = readFixture(file);
      const meta = fixture._meta as { mocked?: boolean } | undefined;
      expect(meta?.mocked, file).toBe(true);
    }
  });

  it("never includes tcgdex pricing on catalog examples", () => {
    const card = readFixture("tcgdex-card-example.json");
    const nested = card.card as Record<string, unknown> | undefined;
    expect(nested).toBeTruthy();
    expect("pricing" in (nested ?? {})).toBe(false);
    expect(card.cardflowNotes).toMatchObject({ pricingOmitted: true });
  });

  it("keeps the three IDs distinct on the high mapping fixture", () => {
    const mapping = readFixture("cardsight-to-tcgdex-mapping-example.json");
    expect(mapping.cardflowCardId).toBe("7c2e1a90-4b3d-4f6a-9c11-2e8f0a1b3c58");
    expect(mapping.tcgdexId).toBe("base1-58");
    expect(mapping.cardsightCardId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    expect(mapping.cardflowCardId).not.toBe(mapping.tcgdexId);
    expect(mapping.cardflowCardId).not.toBe(mapping.cardsightCardId);
    expect(mapping.matchedOn).toEqual(["language", "set", "localId", "name"]);
  });

  it("does not treat name-only as matched", () => {
    const ambiguous = readFixture("tcgdex-ambiguous-match-example.json");
    expect(ambiguous.status).toBe("ambiguous");
    expect(ambiguous.matchedOn).toEqual(["language", "name"]);
    expect(ambiguous.cardflowCardId).toBeNull();
    expect(ambiguous.tcgdexId).toBeNull();
  });
});

describe("max-buy fixtures vs computeMaxBuy", () => {
  it("computes Pikachu $8.00 → $5.57", () => {
    const fixture = readFixture("max-buy-with-reference-price-example.json");
    const maxBuy = fixture.maxBuy as { referencePriceAmount: string; maxBuyAmount: string };
    const computed = computeMaxBuy({
      referencePriceAmount: maxBuy.referencePriceAmount,
      condition: "NM",
    });
    expect(computed.maxBuyAmount).toBe("5.57");
    expect(computed.maxBuyAmount).toBe(maxBuy.maxBuyAmount);
  });

  it("leaves Max Buy null when reference is missing", () => {
    const computed = computeMaxBuy({ referencePriceAmount: null });
    const fixture = readFixture("max-buy-without-reference-price-example.json");
    const maxBuy = fixture.maxBuy as { maxBuyAmount: string | null };
    expect(computed.maxBuyAmount).toBeNull();
    expect(maxBuy.maxBuyAmount).toBeNull();
    expect(computed.display).toBe("Enter a reference price to compute Max Buy.");
  });

  it("computes Charizard $180.00 → $125.28", () => {
    const computed = computeMaxBuy({ referencePriceAmount: "180.00" });
    expect(computed.maxBuyAmount).toBe("125.28");
  });
});

describe("recognition fixtures drive the mock provider", () => {
  it("returns high-confidence Pikachu", async () => {
    const result = await mockCardRecognitionProvider.identifyCard({
      image: new Uint8Array(),
      mimeType: "image/jpeg",
      scenario: "high-confidence",
    });
    expect(identifyCardMock("high-confidence").detections[0]?.name).toBe("Pikachu");
    expect(result.ok).toBe(true);
    expect(result.provider).toBe("mock");
    expect(result.detections[0]?.name).toBe("Pikachu");
    expect(result._meta?.mocked).toBe(true);
  });
});

describe("scan fixture rules", () => {
  it("does not mint cardflow_card_id on scan alone", async () => {
    const scan = readFixture("crm-scan-example.json");
    const body = scan.scan as { cardflowCardId: string | null; inventoryItemId: string | null };
    expect(body.cardflowCardId).toBeNull();
    expect(body.inventoryItemId).toBeNull();
    const mapping = await mapRecognitionToCatalog(identifyCardMock("high-confidence"));
    expect(mapping.cardflowCardId).toBeNull();
  });
});

describe("listing draft fixtures", () => {
  it("matches the default Pikachu title template", () => {
    const titles = readFixture("listing-title-template-example.json");
    expect(renderListingTitle({
      name: "Pikachu",
      setName: "Base Set",
      localId: "58",
      selectedVariant: "normal",
      condition: "NM",
    })).toBe(titles.renderedTitleDefault);
    expect(
      renderListingTitle(
        {
          name: "Pikachu",
          setName: "Base Set",
          localId: "58",
          selectedVariant: "normal",
          condition: "NM",
        },
        "en_raw_single_with_condition",
      ),
    ).toBe(titles.renderedTitleWithConditionTemplate);
  });

  it("computes the Pikachu cost-to-ask spread from the generated draft fixture", () => {
    const generated = readFixture("listing-draft-generated-example.json");
    const cost = generated.costToAsk as { allInTotal: string; askingPrice: string; spread: string };
    const spread = computeCostToAskSpread(cost);
    expect(spread?.spread).toBe("4.96");
    expect(spread?.spread).toBe(cost.spread);
    expect((generated.crmRules as { aiCopyEnabled: boolean }).aiCopyEnabled).toBe(false);
    expect((generated.publication as { published: boolean }).published).toBe(false);
  });

  it("omits private notes from the clipboard fixture payload", () => {
    const clipboard = readFixture("listing-clipboard-export-example.json");
    const body = clipboard.clipboardExport as {
      plainText: string;
      omittedPrivateNotesByDefault: boolean;
      structuredFields: { notes: string | null };
    };
    expect(body.omittedPrivateNotesByDefault).toBe(true);
    expect(body.structuredFields.notes).toBeNull();
    const exported = buildClipboardExport({
      title: "Pikachu - Base Set #58 [normal] EN",
      description: "Raw English Base Set Pikachu #58, NM. Pulled from my binder. Photos are mine.",
      condition: "NM",
      askingPrice: "9.00",
      currency: "USD",
      notes: "Private: all-in was $4.04",
    });
    expect(exported.plainText).toBe(body.plainText);
    expect(exported.plainText).not.toContain("Private");
  });
});
