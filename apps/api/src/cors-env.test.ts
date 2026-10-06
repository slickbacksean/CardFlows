import { describe, expect, it } from "vitest";
import { corsOriginsFromEnv } from "./cors-env";

describe("corsOriginsFromEnv", () => {
  it("parses a comma list and drops blanks", () => {
    expect(
      corsOriginsFromEnv({
        CARD_FLOW_CORS_ORIGINS: " https://cardflow.example , http://localhost:8081/ ",
      }),
    ).toEqual(["https://cardflow.example", "http://localhost:8081"]);
  });

  it("is empty when unset so browsers are not allowed by default", () => {
    expect(corsOriginsFromEnv({})).toEqual([]);
  });
});
