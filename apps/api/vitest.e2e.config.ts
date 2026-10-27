import { defineConfig } from "vitest/config";

// Real-Python grader e2e. Run with `pnpm test:grade-e2e`; not part of `pnpm test`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.e2e.ts"],
    testTimeout: 180_000,
    hookTimeout: 120_000,
    env: {
      CARD_FLOW_STORE: "memory",
      // Grading enabled for e2e tests (production default is off).
      CARD_FLOW_GRADING_ENABLED: "true",
    },
  },
});
