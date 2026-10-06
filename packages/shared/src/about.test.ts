import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FEATURE_FLAG_DEFAULTS } from "./feature-flags";
import {
  ABOUT_LEGAL_REVIEW_NOTE,
  ABOUT_MAX_BODY_PARAGRAPHS,
  ABOUT_MAX_CHARS,
  ABOUT_PARAGRAPHS,
  ABOUT_POKECOLLECTOR_SOURCE_URL,
  ABOUT_TCGDEX_ATTRIBUTION,
  aboutBodyParagraphs,
  aboutIsShort,
  aboutVisibleCopy,
  forbiddenAboutClaim,
  forbiddenAboutVendorSecret,
} from "./about";
import {
  forbiddenSettingsLiveVendorConfig,
  settingsVisibleCopy,
} from "./settings";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readAboutScreen(): string {
  return readFileSync(path.join(repoRoot, "apps/mobile/app/about.tsx"), "utf8");
}

describe("About copy (WIREFRAMES.md §10b)", () => {
  it("matches WIREFRAMES.md §10b without extra guarantees", () => {
    expect(ABOUT_PARAGRAPHS).toEqual([
      "CardFlow is not affiliated with, endorsed by, or sponsored by Nintendo, The Pokémon Company, or Game Freak.",
      "Catalog is TCGdex (via PokéCollector for collection and prices). Capture identify is YOLO OBB + pHash on a still. Livestream is YOLO + card-identity on live video. Grading Prepare may show a photo estimate, not a cert. No marketplace publish.",
      "Catalog images: TCGdex assets (display only). Capture approach: Pokemon-TCGP-Card-Scanner (pipeline only).",
      "PokéCollector AGPL source: https://github.com/Git-Romer/pokecollector",
      "Layout inspired by collector-app chrome (HoloDex); CardFlow is a separate product.",
    ]);
    expect(ABOUT_LEGAL_REVIEW_NOTE).toBe(
      "Recognition is a provider. CardFlow owns inventory and drafts.",
    );
    expect(ABOUT_PARAGRAPHS.join(" ")).toMatch(/Nintendo/);
    expect(ABOUT_PARAGRAPHS.join(" ")).toMatch(/Pokémon Company/);
    expect(ABOUT_PARAGRAPHS.join(" ")).toMatch(/Game Freak/);
    expect(ABOUT_PARAGRAPHS.join(" ")).toMatch(/TCGdex/);
    expect(ABOUT_PARAGRAPHS.join(" ")).toMatch(/PokéCollector/);
    expect(ABOUT_PARAGRAPHS.join(" ")).toMatch(/YOLO OBB \+ pHash/);
    expect(ABOUT_PARAGRAPHS.join(" ")).toMatch(/card-identity on live video/);
    expect(ABOUT_PARAGRAPHS.join(" ")).toMatch(/Pokemon-TCGP-Card-Scanner/);
    expect(ABOUT_PARAGRAPHS.join(" ")).toMatch(/No marketplace publish/);
    expect(ABOUT_PARAGRAPHS.join(" ")).toMatch(/photo estimate, not a cert/);
    expect(ABOUT_PARAGRAPHS.join(" ")).toMatch(/HoloDex/);
    expect(ABOUT_PARAGRAPHS.join(" ")).toMatch(/display only/);
    expect(aboutVisibleCopy()).toContain(ABOUT_LEGAL_REVIEW_NOTE);
    expect(aboutVisibleCopy()).not.toMatch(/placeholder/i);
    expect(aboutVisibleCopy()).not.toMatch(/poketrace/i);
    expect(aboutVisibleCopy()).not.toMatch(/anthropic/i);
  });

  it("does not claim CardFlow verified authentic or accuracy", () => {
    expect(forbiddenAboutClaim(aboutVisibleCopy())).toBeNull();
    expect(aboutVisibleCopy()).not.toMatch(/CardFlow verified authentic/i);
    expect(forbiddenAboutClaim("CardFlow verified authentic")).toBe("verified_authentic");
    expect(forbiddenAboutClaim("Industry-leading identification accuracy")).toBe(
      "accuracy_claim",
    );
  });

  it("About screen renders the shared paragraphs, not free-typed legal", () => {
    const screen = readAboutScreen();
    expect(screen).toContain("aboutBodyParagraphs");
    expect(screen).toContain("ABOUT_LEGAL_REVIEW_NOTE");
    expect(screen).toContain("ABOUT_POKECOLLECTOR_SOURCE_URL");
    expect(screen).toContain("Linking.openURL");
    expect(screen).toContain('accessibilityRole="link"');
    expect(ABOUT_POKECOLLECTOR_SOURCE_URL).toBe("https://github.com/Git-Romer/pokecollector");
    expect(forbiddenAboutClaim(screen)).toBeNull();
    expect(screen).not.toMatch(/verified authentic/i);
    expect(screen).not.toMatch(/\baccurac(?:y|ate|ately)\b/i);
  });
});

describe("About does not grow vendor secrets", () => {
  it("stays short without CardSight keys, self-host runbook, or pricing-provider fields", () => {
    expect(aboutBodyParagraphs()).toEqual([...ABOUT_PARAGRAPHS]);
    expect(aboutBodyParagraphs().length).toBeLessThanOrEqual(ABOUT_MAX_BODY_PARAGRAPHS);
    expect(aboutVisibleCopy().length).toBeLessThanOrEqual(ABOUT_MAX_CHARS);
    expect(aboutIsShort()).toBe(true);

    expect(forbiddenAboutVendorSecret(aboutVisibleCopy())).toBeNull();
    expect(forbiddenAboutVendorSecret("CardSight API key CARDSIGHT_SECRET")).toBe(
      "cardsight_key",
    );
    expect(forbiddenAboutVendorSecret("PokeTrace graded prices")).toBe("poketrace");
    expect(forbiddenAboutVendorSecret("Anthropic Claude vision")).toBe("anthropic_key");
    expect(
      forbiddenAboutVendorSecret("Self-host tcgdex/server on 3000; docker-compose MAX_WORKERS"),
    ).toBe("tcgdex_self_host_runbook");
    expect(
      forbiddenAboutVendorSecret("pricing provider tcgplayer cardmarket variants_detailed"),
    ).toBe("pricing_provider_fields");
    expect(
      forbiddenAboutVendorSecret(
        "Permission is hereby granted, free of charge. THE SOFTWARE IS PROVIDED WITHOUT WARRANTY OF ANY KIND.",
      ),
    ).toBe("full_license");
  });

  it("does not paste a full MIT license; in-app attribution stays optional", () => {
    expect(ABOUT_TCGDEX_ATTRIBUTION).toBeNull();
    expect(aboutVisibleCopy()).toContain("https://github.com/Git-Romer/pokecollector");
    if (ABOUT_TCGDEX_ATTRIBUTION) {
      expect(ABOUT_TCGDEX_ATTRIBUTION.includes("\n")).toBe(false);
      expect(forbiddenAboutVendorSecret(ABOUT_TCGDEX_ATTRIBUTION)).toBeNull();
    }

    const screen = readAboutScreen();
    expect(forbiddenAboutVendorSecret(screen)).toBeNull();
    expect(screen).not.toMatch(/permission is hereby granted/i);
    expect(screen).not.toContain("TextInput");
  });

  it("Settings still has no live-vendor configuration", () => {
    const pricingProviderEnabled: false = FEATURE_FLAG_DEFAULTS.pricing_provider_enabled;
    expect(pricingProviderEnabled).toBe(false);
    expect(forbiddenSettingsLiveVendorConfig(settingsVisibleCopy())).toBeNull();

    const settingsScreen = readFileSync(
      path.join(repoRoot, "apps/mobile/app/settings.tsx"),
      "utf8",
    );
    expect(forbiddenSettingsLiveVendorConfig(settingsScreen)).toBeNull();
    expect(settingsScreen).not.toMatch(/api[_ -]?key/i);
    expect(settingsScreen).not.toContain("TextInput");
    expect(settingsScreen).not.toMatch(/self-host|setEndpoint|tcgdex\/server/i);
    expect(settingsScreen).not.toMatch(/AI grading/i);
    expect(settingsScreen).not.toMatch(/anthropic|poketrace/i);
  });
});
