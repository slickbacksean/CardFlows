import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      CARD_FLOW_STORE: "memory",
      CARD_FLOW_DEV_AUTO_SESSION: "true",
      CARD_FLOW_INVITE_ALEX: "alex-beta",
      CARD_FLOW_INVITE_JORDAN: "jordan-beta",
      // Fast scrypt in tests only (production is 2^17; see password.ts).
      CARD_FLOW_SCRYPT_N: "16384",
      // Grading enabled by default in tests (production default is off).
      CARD_FLOW_GRADING_ENABLED: "true",
    },
  },
});
