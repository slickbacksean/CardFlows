import { describe, expect, it } from "vitest";
import {
  ULTRALYTICS_AGPL_REQUIRED_MESSAGE,
  ultralyticsAgplAccepted,
} from "./ultralytics-license";

describe("Ultralytics AGPL gate", () => {
  it("stays off unless the API env is explicitly true", () => {
    expect(ultralyticsAgplAccepted({})).toBe(false);
    expect(ultralyticsAgplAccepted({ CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED: "" })).toBe(false);
    expect(ultralyticsAgplAccepted({ CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED: "false" })).toBe(false);
    expect(ultralyticsAgplAccepted({ CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED: "true" })).toBe(true);
    expect(ULTRALYTICS_AGPL_REQUIRED_MESSAGE).toContain("AGPL");
  });
});
