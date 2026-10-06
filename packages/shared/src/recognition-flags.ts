import { CONFIRM_COULD_NOT_CONFIRM_MESSAGE } from "./confirm-copy";
import type { CardFlowNormalizedRecognitionResult } from "./types";

/** Kill switch for live CardSight still identify. Resolved from env on the API; CI stays on mock. */
export const CARDSIGHT_IDENTIFY_ENABLED_FLAG = "cardsight_identify_enabled" as const;

/** CardSight market pricing is out of this slice. Not a Settings toggle. */
export const CARDSIGHT_PRICING_ENABLED = false as const;

/** CardSight Enterprise live video is a non-goal. Not a Settings toggle. */
export const CARDSIGHT_LIVE_VIDEO_ENABLED = false as const;

export const CARDSIGHT_PUBLIC_ENDPOINT = "https://api.cardsight.ai";

export const CARDSIGHT_IDENTIFY_FEATURE_DISABLED_MESSAGE = CONFIRM_COULD_NOT_CONFIRM_MESSAGE;

export const STILL_IDENTIFY_SKIPPED_MESSAGE = CARDSIGHT_IDENTIFY_FEATURE_DISABLED_MESSAGE;

export const STILL_IDENTIFY_UNCONFIGURED_MESSAGE = "Could not identify";

/** Live still identify was enabled but the stored still is missing or oversize — never run the model. */
export function stillIdentifySkippedResult(
  _reason: "missing_image" | "oversize_image",
): CardFlowNormalizedRecognitionResult {
  return {
    provider: "mock",
    ok: false,
    vendorRequestId: null,
    processingTimeMs: null,
    detections: [],
    error: {
      code: "BAD_REQUEST",
      message: STILL_IDENTIFY_SKIPPED_MESSAGE,
      retryable: false,
    },
  };
}

/** Flag off outside tests. Not a fixture card. Confirm shows Search manually. */
export function unconfiguredStillIdentifyResult(): CardFlowNormalizedRecognitionResult {
  return {
    provider: "off",
    ok: true,
    vendorRequestId: null,
    processingTimeMs: null,
    detections: [
      {
        confidence: "Low",
        matchLevel: "none",
        vendorCardId: null,
        name: null,
        setName: null,
        number: null,
        language: "en",
        fields: [],
        candidates: [],
      },
    ],
    error: null,
  };
}

/** Live identify was enabled but the stored still is missing or oversize — never call the vendor. */
export function cardsightIdentifySkippedResult(
  reason: "missing_image" | "oversize_image",
): CardFlowNormalizedRecognitionResult {
  return {
    ...stillIdentifySkippedResult(reason),
    provider: "cardsight",
  };
}
