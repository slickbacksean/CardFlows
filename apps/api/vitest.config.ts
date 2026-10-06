import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      CARD_FLOW_STORE: "memory",
      CARD_FLOW_DEV_AUTO_SESSION: "true",
    },
  },
});
