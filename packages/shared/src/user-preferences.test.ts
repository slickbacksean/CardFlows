import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INVITED_USERS } from "./identity";
import { DEFAULT_MAX_BUY_PREFERENCES } from "./max-buy";
import { createUserPreferencesStore } from "./user-preferences";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function exportedFunctionBody(source: string, exportName: string): string {
  const start = source.indexOf(`export function ${exportName}`);
  expect(start).toBeGreaterThan(-1);
  const nextExport = source.indexOf("\nexport ", start + 1);
  return nextExport === -1 ? source.slice(start) : source.slice(start, nextExport);
}

describe("Preferences per invited user", () => {
  it("lets two invited users keep different margins on the same store", () => {
    const alex = INVITED_USERS[0].userId;
    const jordan = INVITED_USERS[1].userId;
    const processStore = createUserPreferencesStore();

    expect(processStore.get(alex)).toEqual(DEFAULT_MAX_BUY_PREFERENCES);
    expect(processStore.get(jordan).targetMarginPct).toBe(0.2);

    processStore.set(alex, {
      ...DEFAULT_MAX_BUY_PREFERENCES,
      targetMarginPct: 0.3,
    });

    expect(processStore.get(alex).targetMarginPct).toBe(0.3);
    expect(processStore.get(jordan)).toEqual(DEFAULT_MAX_BUY_PREFERENCES);
    expect(processStore.get(jordan).targetMarginPct).toBe(0.2);
  });

  it("drops a stored factor that is negative or not a number", () => {
    const alex = INVITED_USERS[0].userId;
    const processStore = createUserPreferencesStore();
    processStore.set(alex, {
      ...DEFAULT_MAX_BUY_PREFERENCES,
      conditionAdjustments: { NM: -5, LP: "x" } as unknown as Record<string, number>,
    });
    expect(processStore.get(alex).conditionAdjustments).toBeNull();
  });

  it("GET/PATCH /v1/preferences read and write the active user's rules", () => {
    const store = readRepoFile("apps/api/src/store.ts");
    const api = readRepoFile("apps/api/src/app.ts");

    expect(store).toContain("createUserPreferencesStore()");
    expect(exportedFunctionBody(store, "getPreferences")).toContain(
      "userPreferences.get(userId)",
    );
    expect(exportedFunctionBody(store, "setPreferences")).toContain(
      "userPreferences.set(userId, next)",
    );
    expect(store).not.toContain("store.preferences");
    const storeInterface = store.slice(
      store.indexOf("interface Store {"),
      store.indexOf("const store: Store"),
    );
    expect(storeInterface).not.toContain("preferences");

    expect(api).toContain('app.get("/v1/preferences"');
    expect(api).toContain('app.patch("/v1/preferences"');
    expect(api).toContain("getPreferences(c.get(\"userId\"))");
    expect(api).toContain("setPreferences(userId, next)");
  });

  it("Max Buy rules reloads the active user's GET on focus", () => {
    const screen = readRepoFile("apps/mobile/app/max-buy-rules.tsx");
    const preferences = readRepoFile("apps/mobile/lib/preferences.ts");
    const identity = readRepoFile("apps/mobile/lib/identity.ts");

    const focusStart = screen.indexOf("useFocusEffect");
    const peek = screen.indexOf("applyPreferences(peekMaxBuyPreferences())", focusStart);
    const load = screen.indexOf("loadMaxBuyPreferences()", focusStart);

    expect(focusStart).toBeGreaterThan(-1);
    expect(peek).toBeGreaterThan(focusStart);
    expect(load).toBeGreaterThan(peek);

    expect(preferences).toContain("lastSuccessfulByUserId");
    expect(preferences).toContain("peekActiveUserId()");
    expect(identity).toContain("export function peekActiveUserId()");
  });
});
