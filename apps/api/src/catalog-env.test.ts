import { describe, expect, it } from "vitest";
import {
  TCGDEX_PRICING_IGNORED,
  TCGDEX_SELF_HOSTED,
} from "@cardflow/shared";
import { createCatalogFromEnv, resolveCatalogSelection } from "./catalog-env";

describe("catalog env selection", () => {
  it("keeps CI on mock when the live flag is off or unset", () => {
    expect(resolveCatalogSelection({ VITEST: "true" })).toMatchObject({
      kind: "mock",
      enabled: false,
      selfHosted: false,
      pricingIgnored: true,
      reason: "test without live catalog",
    });
    expect(
      resolveCatalogSelection({ VITEST: "true", CARD_FLOW_TCGDEX_CATALOG_ENABLED: "false" }),
    ).toMatchObject({
      kind: "mock",
      enabled: false,
      reason: "test with tcgdex_catalog_enabled off",
    });
    expect(createCatalogFromEnv({ VITEST: "true" }).catalog.name).toBe("mock");
    expect(createCatalogFromEnv({ NODE_ENV: "test" }).catalog.featureDisabled).toBeFalsy();
  });

  it("enables live TCGdex in local/staging when network is allowed", () => {
    expect(resolveCatalogSelection({})).toEqual({
      kind: "tcgdex",
      enabled: true,
      selfHosted: TCGDEX_SELF_HOSTED,
      pricingIgnored: TCGDEX_PRICING_IGNORED,
      reason: "local/staging network allowed",
    });
    expect(
      resolveCatalogSelection({ CARD_FLOW_TCGDEX_CATALOG_ENABLED: "true" }),
    ).toMatchObject({ kind: "tcgdex", enabled: true });
  });

  it("returns FEATURE_DISABLED outside tests when the flag is off", () => {
    const selection = resolveCatalogSelection({
      NODE_ENV: "production",
      CARD_FLOW_TCGDEX_CATALOG_ENABLED: "false",
    });
    expect(selection).toMatchObject({
      kind: "disabled",
      enabled: false,
      selfHosted: false,
      pricingIgnored: true,
    });
    expect(createCatalogFromEnv({
      NODE_ENV: "production",
      CARD_FLOW_TCGDEX_CATALOG_ENABLED: "false",
    }).catalog.featureDisabled).toBe(true);
  });

  it("selects PokéCollector over TCGdex when the URL is set outside tests", () => {
    expect(
      resolveCatalogSelection({
        CARD_FLOW_POKECOLLECTOR_URL: "http://127.0.0.1:8000",
      }),
    ).toMatchObject({
      kind: "pokecollector",
      enabled: true,
      pricingIgnored: true,
    });
    expect(
      resolveCatalogSelection({
        NODE_ENV: "production",
        CARD_FLOW_POKECOLLECTOR_URL: "http://127.0.0.1:8000",
        CARD_FLOW_POKECOLLECTOR_ENABLED: "false",
      }),
    ).toMatchObject({ kind: "tcgdex", enabled: true });
  });
});
