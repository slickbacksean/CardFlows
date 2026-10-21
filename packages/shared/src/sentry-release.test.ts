import { describe, expect, it } from "vitest";
import { sentryReleaseTags } from "./sentry-release";

describe("sentryReleaseTags", () => {
  it("tags release with version and build", () => {
    expect(sentryReleaseTags({ bundleId: "app.pokesniper.mobile", version: "1.0.0", build: 7, appEnv: "production" })).toEqual({
      release: "app.pokesniper.mobile@1.0.0+7",
      dist: "7",
      environment: "production",
    });
  });
  it("prefers SENTRY_ENVIRONMENT, then the EAS channel, then the profile", () => {
    expect(sentryReleaseTags({ sentryEnvironment: "staging", updatesChannel: "preview", appEnv: "preview" }).environment).toBe("staging");
    expect(sentryReleaseTags({ updatesChannel: "preview", appEnv: "production" }).environment).toBe("preview");
    expect(sentryReleaseTags({}).environment).toBe("development");
    expect(sentryReleaseTags({ version: "1.0.0" })).toEqual({ release: "app.pokesniper.mobile@1.0.0", environment: "development" });
  });
});
