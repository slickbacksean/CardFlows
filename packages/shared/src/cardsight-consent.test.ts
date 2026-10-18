import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CARDSIGHT_AI_DISCLOSURES, CARDSIGHT_CONSENT_COPY, CARDSIGHT_CONSENT_VERSION } from "./cardsight-consent";
import { CAMERA_USAGE_DESCRIPTION } from "./permission-copy";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|json)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const QUOTED = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`|>[^<>{}]+</g;
const unquote = (chunk: string) => chunk.slice(1, -1).replace(/\\'/g, "'").replace(/\\"/g, '"');

describe("CardSight disclosure (Policy Reviewer, Oct 16)", () => {
  it("uses the approved wording exactly, with a bumped version", () => {
    expect(CARDSIGHT_CONSENT_COPY.body).toBe(
      "CardFlow can use CardSight, our card-recognition provider, to identify cards from your photos. If you allow it, your card photos are sent to CardSight. CardSight's terms let it keep these images and use them to train its AI models. Turning this off later stops new uploads but doesn't remove photos CardSight already has. If you don't allow it, CardFlow matches cards on its own servers, or you can search manually. You can change this anytime in Settings.",
    );
    expect(CARDSIGHT_CONSENT_COPY.settingsHelp).toBe(
      "When on, card photos are also sent to CardSight, our card-recognition provider. CardSight's terms let it keep these images and use them to train its AI models. Turning this off stops new uploads but doesn't remove photos CardSight already has. When off, CardFlow matches cards on its own servers only.",
    );
    expect(CARDSIGHT_CONSENT_VERSION).not.toBe("2026-10-17");
    expect(CARDSIGHT_AI_DISCLOSURES).toEqual([CARDSIGHT_CONSENT_COPY.body, CARDSIGHT_CONSENT_COPY.settingsHelp]);
  });

  it("camera permission strings are exact in app.json", () => {
    const expected =
      "CardFlow uses the camera to photograph your Pokémon cards. Photos are uploaded to CardFlow, and to our card-recognition provider if you allow it, to identify your cards.";
    expect(CAMERA_USAGE_DESCRIPTION).toBe(expected);
    const app = JSON.parse(readFileSync(path.join(REPO, "apps/mobile/app.json"), "utf8")) as {
      expo: { ios: { infoPlist: Record<string, string> }; plugins: Array<string | [string, Record<string, unknown>]> };
    };
    expect(app.expo.ios.infoPlist.NSCameraUsageDescription).toBe(expected);
    const camera = app.expo.plugins.find((p) => Array.isArray(p) && p[0] === "expo-camera") as [string, Record<string, unknown>];
    expect(camera[1].cameraPermission).toBe(expected);
  });

  it('"AI" appears in app copy only inside the CardSight disclosure (all estimate copy stays covered)', () => {
    const files = [
      ...sourceFiles(path.join(REPO, "apps/mobile/app")),
      ...sourceFiles(path.join(REPO, "apps/mobile/components")),
      ...sourceFiles(path.join(REPO, "apps/mobile/lib")),
      ...sourceFiles(path.join(REPO, "apps/mobile/store")),
      path.join(REPO, "apps/mobile/app.json"),
      ...sourceFiles(path.join(REPO, "packages/shared/src")),
      ...sourceFiles(path.join(REPO, "apps/api/src")),
    ];
    const offenders: string[] = [];
    let disclosuresSeen = 0;
    for (const file of files) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
          for (const chunk of line.match(QUOTED) ?? []) {
            if (!/\bAI\b/.test(chunk)) continue;
            if (CARDSIGHT_AI_DISCLOSURES.includes(unquote(chunk))) {
              disclosuresSeen += 1;
              continue;
            }
            offenders.push(`${path.relative(REPO, file)}:${i + 1}: ${chunk.slice(0, 80)}`);
          }
        });
    }
    expect(offenders).toEqual([]);
    expect(disclosuresSeen).toBe(2); // the exemption matches the real strings, nothing else
  });

  it("the capture screen asks before any photo upload (accounts only; guest look-around removed)", () => {
    const capture = readFileSync(path.join(REPO, "apps/mobile/app/capture.tsx"), "utf8");
    const ask = capture.indexOf("await askCardSightConsentOnce()");
    expect(ask).toBeGreaterThan(-1);
    expect(ask).toBeLessThan(capture.indexOf("await createScan("));
    expect(capture).toMatch(/if \(imageUri && \(await ensureAccountAgeConfirmed\(\)\)\) \{\s*await askCardSightConsentOnce\(\)/);
  });
});
