import { describe, expect, it } from "vitest";
import { parseGradeEstimateFormFields, parseGradeEstimateJson } from "./grade-estimate-request";

describe("grade estimate Zod validation", () => {
  it("accepts empty JSON and rejects vendor urls or extra fields", () => {
    expect(parseGradeEstimateJson({})).toEqual({
      frontImage: null,
      backImage: null,
      reestimate: false,
    });
    expect(
      parseGradeEstimateJson({
        front: "https://assets.tcgdex.net/en/base/base1/58/high.webp",
      }),
    ).toEqual({ error: "Unexpected field", status: 400 });
    expect(parseGradeEstimateJson({ apiKey: "secret" })).toEqual({
      error: "Unexpected field",
      status: 400,
    });
  });

  it("allows optional front and back files and rejects extra multipart fields", () => {
    expect(parseGradeEstimateFormFields({ front: "file", back: "file" })).toEqual({
      front: "file",
      back: "file",
      reestimate: false,
    });
    expect(parseGradeEstimateFormFields({})).toEqual({
      front: undefined,
      back: undefined,
      reestimate: false,
    });
    expect(
      parseGradeEstimateFormFields({
        front: "file",
        "X-API-Key": "secret",
      }),
    ).toEqual({ error: "Unexpected field", status: 400 });
  });
});
