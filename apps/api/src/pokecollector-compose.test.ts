import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveCatalogSelection } from "./catalog-env";
import { resolveStoreSelection } from "./store-env";

const srcDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(srcDir, "../../..");
const composePath = path.join(repoRoot, "infra/pokecollector/docker-compose.yml");
const composeEnvExamplePath = path.join(
  repoRoot,
  "infra/pokecollector/.env.example",
);
const apiEnvExamplePath = path.join(repoRoot, "apps/api/.env.example");
const gitignorePath = path.join(repoRoot, ".gitignore");

function assignmentValues(source: string, key: string): string[] {
  return [...source.matchAll(new RegExp(`(?:^|\\n)${key}=(.*)$`, "gm"))].map(
    (match) => (match[1] ?? "").trim(),
  );
}

describe("PokéCollector local compose", () => {
  const compose = readFileSync(composePath, "utf8");
  const composeEnvExample = readFileSync(composeEnvExamplePath, "utf8");
  const apiEnvExample = readFileSync(apiEnvExamplePath, "utf8");
  const gitignore = readFileSync(gitignorePath, "utf8");

  it("pins unmodified GHCR backend + Postgres and English sync, not latest or tcgdex/server", () => {
    expect(compose).toContain("ghcr.io/git-romer/pokecollector-backend:1.51.0");
    expect(compose).toContain("postgres:18-alpine");
    expect(compose).toMatch(/TCGDEX_SYNC_LANGUAGES:\s*en\b/);
    expect(compose).toContain("OPENAI_SCANNER_ENABLED: \"false\"");
    expect(compose).toContain("PUBLIC_MODE: \"false\"");
    expect(compose).not.toMatch(/image:.*:latest\b/);
    expect(compose).not.toMatch(/image:.*tcgdex\/server|image:.*cards-database/);
    expect(compose).not.toContain("build:");
    expect(compose).toContain("TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN:-}");
    expect(compose).toContain("GEMINI_API_KEY: ${GEMINI_API_KEY:-}");
  });

  it("does not copy PokéCollector AGPL source into apps/ or packages/", () => {
    expect(existsSync(path.join(repoRoot, "apps/pokecollector"))).toBe(false);
    expect(existsSync(path.join(repoRoot, "packages/pokecollector"))).toBe(false);
    expect(existsSync(path.join(repoRoot, "apps/backend"))).toBe(false);
    expect(existsSync(path.join(repoRoot, "apps/frontend"))).toBe(false);
  });

  it("gitignores compose volumes and keeps .env.example secrets empty", () => {
    expect(gitignore).toContain("infra/pokecollector/data/");
    expect(apiEnvExample).toContain("CARD_FLOW_POKECOLLECTOR_URL=");
    expect(assignmentValues(apiEnvExample, "CARD_FLOW_POKECOLLECTOR_URL")).toEqual([
      "",
    ]);
    expect(apiEnvExample).toContain("CARD_FLOW_POKECOLLECTOR_TOKEN=");
    expect(assignmentValues(apiEnvExample, "CARD_FLOW_POKECOLLECTOR_TOKEN")).toEqual([
      "",
    ]);
    expect(assignmentValues(apiEnvExample, "CARDSIGHT_API_KEY")).toEqual([""]);
    expect(assignmentValues(apiEnvExample, "XAI_API_KEY")).toEqual([]);
    for (const key of [
      "POSTGRES_PASSWORD",
      "JWT_SECRET_KEY",
      "ADMIN_PASSWORD",
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_CHAT_ID",
      "GEMINI_API_KEY",
    ]) {
      expect(assignmentValues(composeEnvExample, key)).toEqual([""]);
    }
  });

  it("keeps pnpm test on mocks without Docker Postgres", () => {
    expect(process.env.CARD_FLOW_STORE).toBe("memory");
    expect(
      resolveStoreSelection({
        VITEST: "true",
        CARD_FLOW_POKECOLLECTOR_URL: "http://127.0.0.1:8000",
      }),
    ).toMatchObject({ kind: "memory" });
    expect(
      resolveCatalogSelection({
        VITEST: "true",
        CARD_FLOW_POKECOLLECTOR_URL: "http://127.0.0.1:8000",
      }),
    ).toMatchObject({ kind: "mock" });
  });
});
