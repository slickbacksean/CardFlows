import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { confirmEstimateCopyViolations } from "./confirm-copy";
import {
  ESTIMATED_SPREAD_NOTE,
  MAKE_LISTING_LABEL,
  estimatedSpreadLine,
  listingReadiness,
} from "./listing-builder";
import { listingDraftEstimateChip } from "./listing-draft";

const all = { corners: "sharp", edges: "clean", surface: "clean", whitening: "none noted", centering: "looks good" };

describe("P2-02 listing builder", () => {
  it("tracks readiness", () => {
    const empty = listingReadiness({ title: "", condition: null, askingPrice: null, disclosure: {} });
    expect(empty).toMatchObject({ done: 0, total: 4, label: "0 of 4 ready", readyToCopy: false });
    const copyable = listingReadiness({ title: "Pikachu 58/102", condition: "NM", askingPrice: "12", disclosure: {} });
    expect(copyable).toMatchObject({ done: 3, readyToCopy: true });
    expect(listingReadiness({ title: "x", condition: "NM", askingPrice: "12", disclosure: all }).label).toBe("4 of 4 ready");
  });

  it("estimated spread names its source and time and never shows $0 for a missing cost", () => {
    const line = estimatedSpreadLine({ askingPrice: "16.50", allInTotal: "12.00", at: "2026-10-14T19:00:00Z" });
    expect(line?.amount).toBe("$4.50");
    expect(line?.line).toMatch(/^Estimated spread \$4\.50 · your asking price vs all-in cost · Oct 1[45]$/);
    expect(estimatedSpreadLine({ askingPrice: "10", allInTotal: "12" })?.amount).toBe("-$2.00");
    expect(estimatedSpreadLine({ askingPrice: "10", allInTotal: null })).toBeNull();
  });

  it("copy passes the guards: no profit promise, no company names, no market price", () => {
    for (const text of [ESTIMATED_SPREAD_NOTE, MAKE_LISTING_LABEL, estimatedSpreadLine({ askingPrice: "5", allInTotal: "1" })!.line]) {
      expect(confirmEstimateCopyViolations(text)).toEqual([]);
      expect(text).not.toMatch(/\bmarket price\b|you will make|guaranteed profit/i);
    }
    const chip = JSON.stringify(listingDraftEstimateChip(7.5));
    expect(chip).not.toMatch(/\bAI\b|PSA|BGS|CGC/);
  });

  it("Decide offers Purchased + make listing and the draft screen shows readiness", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const decide = readFileSync(resolve(here, "../../../apps/mobile/app/decide/[cardflowCardId].tsx"), "utf8");
    expect(decide).toContain("MAKE_LISTING_LABEL");
    expect(decide).toContain("openOrCreateDraft");
    const draft = readFileSync(resolve(here, "../../../apps/mobile/app/draft/[draftId].tsx"), "utf8");
    expect(draft).toContain("listingReadiness");
    expect(draft).toContain("estimatedSpreadLine");
  });
});
