import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function functionBody(source: string, exportName: string): string {
  const start = source.indexOf(`export async function ${exportName}`);
  expect(start).toBeGreaterThan(-1);
  const nextExport = source.indexOf("\nexport ", start + 1);
  return nextExport === -1 ? source.slice(start) : source.slice(start, nextExport);
}

describe("PATCH is the Max Buy save path", () => {
  it("opens Max Buy with GET and saves with PATCH", () => {
    const preferences = readRepoFile("apps/mobile/lib/preferences.ts");
    const load = functionBody(preferences, "loadMaxBuyPreferences");
    const save = functionBody(preferences, "saveMaxBuyPreferences");
    const api = readRepoFile("apps/api/src/app.ts");

    expect(load).toContain("await getPreferences()");
    expect(load).toContain("rememberSuccessful(result.preferences)");
    expect(load).not.toMatch(/if \(lastSuccessful\) return/);
    expect(load).not.toMatch(/if \(localOverride\) return/);

    expect(save).toContain("await patchPreferences(withLockedDisplayCurrency(preferences))");
    expect(save).toContain("rememberSuccessful(result.preferences)");
    expect(save).not.toMatch(/GET-only/);
    expect(save).not.toMatch(/catch \{/);

    expect(api).toContain('app.get("/v1/preferences"');
    expect(api).toContain('app.patch("/v1/preferences"');
  });

  it("surfaces PATCH failure instead of caching unsaved rules", () => {
    const preferences = readRepoFile("apps/mobile/lib/preferences.ts");
    const save = functionBody(preferences, "saveMaxBuyPreferences");
    const screen = readRepoFile("apps/mobile/app/max-buy-rules.tsx");

    expect(save.indexOf("await patchPreferences")).toBeLessThan(
      save.indexOf("rememberSuccessful(result.preferences)"),
    );
    expect(preferences).toContain("Last successful GET/PATCH only");
    expect(screen).toContain("saveMaxBuyPreferences(parsed.preferences)");
    expect(screen).toContain('caught instanceof Error ? caught.message : "Could not save rules"');
    expect(screen).toContain("Could not load rules");
  });
});
