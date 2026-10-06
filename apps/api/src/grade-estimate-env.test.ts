import { describe, expect, it } from "vitest";
import {
  createGradeEstimateFromEnv,
  resolveGradeEstimateSelection,
} from "./grade-estimate-env";

const present = { vendorPresent: () => true, python: () => "/usr/bin/python3" };

describe("grade estimate env selection", () => {
  it("keeps CI on mock", () => {
    expect(resolveGradeEstimateSelection({ VITEST: "true" })).toEqual({
      kind: "mock",
      reason: "test fixture grade estimate",
    });
    const created = createGradeEstimateFromEnv({ VITEST: "true" });
    expect(created.grading.name).toBe("mock");
    expect(created.cardgrading).toBeNull();
  });

  it("turns the feature off when the flag is false", () => {
    const env = { NODE_ENV: "production", CARD_FLOW_GRADE_ESTIMATE_ENABLED: "false" };
    expect(resolveGradeEstimateSelection(env, present)).toEqual({
      kind: "off",
      reason: "grade_estimate_enabled=false",
    });
    const created = createGradeEstimateFromEnv(env, present);
    expect(created.grading.name).toBe("off");
    expect(created.cardgrading).toBeNull();
  });

  it("uses the offline cardgrading library when vendor files and python exist", () => {
    const env = { NODE_ENV: "production", CARD_FLOW_GRADE_ESTIMATE_ENABLED: "true" };
    expect(resolveGradeEstimateSelection(env, present).kind).toBe("cardgrading");
    const created = createGradeEstimateFromEnv(env, present);
    expect(created.grading.name).toBe("cardgrading");
    expect(created.cardgrading).not.toBeNull();
  });

  it("ignores any XAI key: there is no model grader to select", () => {
    const env = {
      NODE_ENV: "production",
      CARD_FLOW_GRADE_ESTIMATE_ENABLED: "true",
      XAI_API_KEY: "not-a-real-key",
    };
    expect(resolveGradeEstimateSelection(env, present).kind).toBe("cardgrading");
    expect(
      resolveGradeEstimateSelection(env, { ...present, python: () => null }).kind,
    ).toBe("off");
  });

  it("is off, never a fixture, when python or the vendor tree is missing", () => {
    const env = { NODE_ENV: "production" };
    expect(resolveGradeEstimateSelection(env, { ...present, python: () => null })).toMatchObject({
      kind: "off",
    });
    expect(
      resolveGradeEstimateSelection(env, { ...present, vendorPresent: () => false }),
    ).toEqual({ kind: "off", reason: "vendor/cardgrading missing" });
    expect(createGradeEstimateFromEnv(env, { ...present, python: () => null }).grading.name).toBe(
      "off",
    );
  });
});
