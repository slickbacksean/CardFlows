import { describe, expect, it } from "vitest";
import {
  CARDSIGHT_LIVE_VIDEO_ENABLED,
  CARDSIGHT_PRICING_ENABLED,
} from "@cardflow/shared";
import { createRecognitionFromEnv, resolveRecognitionSelection } from "./recognition-env";

describe("recognition env selection", () => {
  it("keeps CI on mock and never enables CardSight", () => {
    expect(resolveRecognitionSelection({ VITEST: "true" })).toEqual({
      kind: "mock",
      identifyEnabled: false,
      pricingEnabled: false,
      liveVideoEnabled: false,
      reason: "test without live identify",
    });
    expect(
      resolveRecognitionSelection({
        VITEST: "true",
        CARD_FLOW_CARDSIGHT_IDENTIFY_ENABLED: "true",
        CARDSIGHT_API_KEY: "not-a-real-key",
        CARD_FLOW_OBB_PHASH_ENABLED: "true",
      }),
    ).toMatchObject({
      kind: "mock",
      identifyEnabled: false,
      reason: "test without live identify",
    });
    expect(createRecognitionFromEnv({ VITEST: "true" }).recognition.name).toBe("mock");
  });

  it("does not enable live identify from a CardSight key", () => {
    expect(
      resolveRecognitionSelection({
        NODE_ENV: "production",
        CARD_FLOW_CARDSIGHT_IDENTIFY_ENABLED: "true",
        CARDSIGHT_API_KEY: "not-a-real-key",
      }),
    ).toEqual({
      kind: "off",
      identifyEnabled: false,
      pricingEnabled: CARDSIGHT_PRICING_ENABLED,
      liveVideoEnabled: CARDSIGHT_LIVE_VIDEO_ENABLED,
      reason: "obb_phash_enabled=false",
    });
    expect(
      createRecognitionFromEnv({
        NODE_ENV: "production",
      }).recognition.name,
    ).toBe("off");
  });

  it("enables stored-still identify from CARD_FLOW_OBB_PHASH_ENABLED outside tests", () => {
    expect(
      createRecognitionFromEnv({
        NODE_ENV: "production",
        CARD_FLOW_OBB_PHASH_ENABLED: "true",
      }).recognition.name,
    ).toBe("obb_phash");
    expect(
      resolveRecognitionSelection({
        NODE_ENV: "production",
        CARD_FLOW_OBB_PHASH_ENABLED: "true",
      }),
    ).toMatchObject({
      kind: "obb_phash",
      identifyEnabled: true,
      pricingEnabled: false,
      liveVideoEnabled: false,
      reason: "CARD_FLOW_OBB_PHASH_ENABLED=true",
    });
  });
});
