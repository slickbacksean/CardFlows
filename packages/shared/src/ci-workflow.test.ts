import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("CI workflow", () => {
  it("runs install, test, typecheck, and mobile lint on a pull request without secrets or models", () => {
    const workflow = readRepoFile(".github/workflows/ci.yml");

    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("pnpm install --frozen-lockfile");
    expect(workflow).toContain("pnpm test");
    expect(workflow).toContain("pnpm typecheck");
    expect(workflow).toContain("pnpm --filter @cardflow/mobile lint");
    expect(workflow).not.toMatch(/secrets\./);
    expect(workflow).not.toMatch(/\.onnx|\.pth/i);
    expect(workflow).not.toMatch(/API_KEY|TOKEN|PASSWORD/i);
  });
});
