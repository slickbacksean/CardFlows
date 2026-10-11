import { describe, expect, it } from "vitest";
import {
  ULTRALYTICS_AGPL_REQUIRED_MESSAGE,
  YOLO26N_LICENSE_SHIP_TODO,
  ultralyticsAgplAccepted,
  ultralyticsAgplAcceptedForClient,
  yolo26nOnDeviceAllowed,
} from "./ultralytics-license";

describe("Ultralytics AGPL gate", () => {
  it("stays off unless the API env is explicitly true", () => {
    expect(ultralyticsAgplAccepted({})).toBe(false);
    expect(ultralyticsAgplAccepted({ CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED: "" })).toBe(false);
    expect(ultralyticsAgplAccepted({ CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED: "false" })).toBe(false);
    expect(ultralyticsAgplAccepted({ CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED: "true" })).toBe(true);
    expect(ultralyticsAgplAcceptedForClient({ EXPO_PUBLIC_CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED: "true" })).toBe(
      true,
    );
    expect(ULTRALYTICS_AGPL_REQUIRED_MESSAGE).toContain("AGPL");
    expect(YOLO26N_LICENSE_SHIP_TODO).toContain("Enterprise");
    expect(
      yolo26nOnDeviceAllowed({
        easBuildProfile: "production",
        env: {
          CARD_FLOW_ULTRALYTICS_AGPL_ACCEPTED: "true",
          CARD_FLOW_YOLO26N_ONDEVICE: "true",
        },
      }),
    ).toBe(false);
  });
});
