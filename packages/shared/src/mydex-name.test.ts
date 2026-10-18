import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COLLECTION_DESTINATION_NAME, SCREEN_EMPTY_COPY, SCREEN_ERROR_WHAT, SCREEN_LOADING_LABELS } from "./screen-states";

/**
 * Sean (Oct 17): the owned-cards screen has one user-facing name, MyDEX. No user-facing copy
 * may call it "Collection". Code names (routes, keys, file names) are not copy and stay.
 */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** Quoted strings and JSX text: the same chunks the pre-grade copy test reads. */
function chunks(line: string): string[] {
  return line.match(/"[^"]*"|'[^']*'|`[^`]*`|>[^<>{}]+</g) ?? [];
}

/** Not about the screen: card set names, other apps' "collection", API paths, code names. */
const NOT_THE_SCREEN = [
  /Legendary Collection/,
  /TCG Trader collection/,
  /PokéCollector for collection/,
  /\/(api|v1)\/collection/,
];

function collectionNameOffenders(files: string[]): string[] {
  const offenders: string[] = [];
  for (const file of files) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        for (const chunk of chunks(line)) {
          if (!/\bcollection\b/i.test(chunk)) continue;
          // Copy reads like words: a space and no path or identifier punctuation around it.
          if (!/\s/.test(chunk.slice(1, -1).trim())) continue;
          if (/\(tabs\)\/collection|[A-Za-z]Collection|collection[A-Z_]/.test(chunk)) continue;
          if (NOT_THE_SCREEN.some((pattern) => pattern.test(chunk))) continue;
          offenders.push(`${path.relative(REPO, file)}:${index + 1}: ${chunk}`);
        }
      });
  }
  return offenders;
}

describe("MyDEX is the one user-facing name (Sean, Oct 17)", () => {
  it("the shared name and the copy built from it", () => {
    expect(COLLECTION_DESTINATION_NAME).toBe("MyDEX");
    expect(SCREEN_EMPTY_COPY.gradePrepare.action).toBe("Open MyDEX");
    expect(SCREEN_ERROR_WHAT.collection).toBe("MyDEX");
    expect(SCREEN_LOADING_LABELS.collection).toBe("Loading MyDEX");
  });

  it("no user-facing copy in the app, shared or API calls the screen Collection", () => {
    const files = [
      path.join(REPO, "apps/mobile/app"),
      path.join(REPO, "apps/mobile/components"),
      path.join(REPO, "apps/mobile/lib"),
      path.join(REPO, "packages/shared/src"),
      path.join(REPO, "apps/api/src"),
    ].flatMap((dir) => sourceFiles(dir));
    expect(collectionNameOffenders(files)).toEqual([]);
  });

  it("the check catches the old wording", () => {
    const lines = ['label: "Open Collection"', 'hint="Returns to Collection"', '"Search collection"', '"Legendary Collection"', 'router.push("/(tabs)/collection")'];
    const hits = lines.filter((line) =>
      chunks(line).some(
        (chunk) =>
          /\bcollection\b/i.test(chunk) &&
          /\s/.test(chunk.slice(1, -1).trim()) &&
          !NOT_THE_SCREEN.some((pattern) => pattern.test(chunk)),
      ),
    );
    expect(hits).toEqual(lines.slice(0, 3));
  });

  it("the tab and screen titles say MyDEX", () => {
    const layout = readFileSync(path.join(REPO, "apps/mobile/app/(tabs)/_layout.tsx"), "utf8");
    expect(layout).toContain('title: "MyDEX"');
    expect(layout).toContain('tabBarLabel: "MyDEX"');
  });
});
