import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GRADE_ESTIMATE_DISCLAIMER,
  GRADE_ESTIMATE_NEEDS_BACK_COPY,
  GRADE_PHOTOS_HINT,
  GRADING_TAB_CONSTRAINT,
  parseStoredGradeEstimate,
} from "./grade-estimate";
import {
  buildClipboardExport,
  descriptionStarter,
  disclosureSnippet,
  keywordChips,
  listingDraftEstimateChip,
  renderListingTitle,
} from "./listing-draft";
import { PREGRADE_DISCLAIMER, PREGRADE_LABEL, PREGRADE_SURFACE_NULL_REASON } from "./photo-pregrade";
import {
  GRADE_FLOW_RETAKE_HEADING,
  GRADE_FLOW_RETRY_LABEL,
  GRADE_FLOW_UNAVAILABLE_BODY,
} from "./grade-flow-resilience";
import { PREGRADE_COPY, pregradeCopyViolations } from "./pregrade-copy";
import { SHARE_CARD_COPY, shareCardVisibleCopy } from "./share-card-copy";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");

function sourceFiles(dir: string, match: RegExp = /\.(ts|tsx)$/): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full, match));
    else if (match.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

function quotedUserFacingChunks(line: string): string[] {
  return line.match(/"[^"]*"|'[^']*'|`[^`]*`|>[^<>{}]+</g) ?? [];
}

function collectOffenders(files: string[]): string[] {
  const offenders: string[] = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      for (const chunk of quotedUserFacingChunks(line)) {
        if (pregradeCopyViolations(chunk).length > 0) {
          offenders.push(`${path.relative(REPO, file)}:${index + 1}: ${chunk}`);
        }
      }
    });
  }
  return offenders;
}

function jsonStringValues(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) jsonStringValues(item, out);
  else if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) jsonStringValues(item, out);
  }
  return out;
}

const listingPikachu = {
  name: "Pikachu",
  setName: "Base Set",
  localId: "58",
  selectedVariant: "normal",
  condition: "NM",
};

describe("pre-grade copy", () => {
  it("uses the standing title and disclaimer everywhere", () => {
    expect(PREGRADE_LABEL).toBe("Pre-grade estimate");
    expect(PREGRADE_DISCLAIMER).toBe("Estimate only. Not an official grade.");
    expect(GRADE_ESTIMATE_DISCLAIMER).toBe(PREGRADE_DISCLAIMER);
    expect(PREGRADE_SURFACE_NULL_REASON).toBe("Surface not assessed from a single photo.");
    expect(SHARE_CARD_COPY.estimateTitle).toBe(PREGRADE_COPY.title);
    expect(SHARE_CARD_COPY.estimateDisclaimer).toBe(PREGRADE_COPY.disclaimer);
    expect(listingDraftEstimateChip().label).toBe(PREGRADE_COPY.title);
    expect(listingDraftEstimateChip().disclaimer).toBe(PREGRADE_COPY.disclaimer);
  });

  it("never says a model name or a grading company in estimate constants", () => {
    const strings = [
      ...Object.values(PREGRADE_COPY),
      GRADE_ESTIMATE_DISCLAIMER,
      GRADE_ESTIMATE_NEEDS_BACK_COPY,
      GRADE_PHOTOS_HINT,
      GRADING_TAB_CONSTRAINT,
      GRADE_FLOW_RETRY_LABEL,
      GRADE_FLOW_UNAVAILABLE_BODY,
      GRADE_FLOW_RETAKE_HEADING,
      ...Object.values(SHARE_CARD_COPY),
    ];
    for (const text of strings) expect(pregradeCopyViolations(text), text).toEqual([]);
  });

  it("rewrites estimates saved with the old copy", () => {
    const stored = parseStoredGradeEstimate(
      JSON.stringify({ notACert: true, overall: 7.5, display: "AI pre-grade 7.5" }),
    );
    expect(stored?.display).toBe("Pre-grade 7.5");
    expect(stored?.disclaimer).toBe("Estimate only. Not an official grade.");
    expect(pregradeCopyViolations(stored?.display ?? "")).toEqual([]);
    expect(pregradeCopyViolations(stored?.disclaimer ?? "")).toEqual([]);
  });

  it("flags banned wording so CI fails on estimate copy regressions", () => {
    expect(
      pregradeCopyViolations("AI pre-grade estimate. Not an official PSA, BGS, or CGC grade."),
    ).toEqual([/\bAI\b/i.source, /\bPSA\b/i.source, /\bBGS\b/i.source, /\bCGC\b/i.source]);
  });

  it("grading screens and the pre-grade API have no banned words in quoted copy", () => {
    const files = [
      ...sourceFiles(path.join(REPO, "apps", "mobile", "components", "ui")).filter((file) =>
        /(photo-grade-flow|grade-camera|prepare-sheet|returned-sheet|submitted-sheet)\.tsx$/.test(
          file,
        ),
      ),
      path.join(REPO, "apps", "mobile", "app", "(tabs)", "grading.tsx"),
      path.join(REPO, "apps", "api", "src", "cardgrading-map.ts"),
      path.join(REPO, "apps", "api", "src", "grade-photo-flow.ts"),
      path.join(REPO, "packages", "shared", "src", "pregrade-copy.ts"),
      path.join(REPO, "packages", "shared", "src", "photo-pregrade.ts"),
      path.join(REPO, "packages", "shared", "src", "listing-draft.ts"),
      path.join(REPO, "packages", "shared", "src", "share-card-copy.ts"),
    ];
    expect(collectOffenders(files)).toEqual([]);
  });

  it("listing-draft output never uses banned estimate wording", () => {
    const clipboard = buildClipboardExport({
      title: renderListingTitle(listingPikachu),
      description: [
        descriptionStarter(listingPikachu),
        disclosureSnippet({
          corners: "sharp",
          edges: "clean",
          surface: "light sleeve scuffs",
          whitening: "none noted",
          centering: "looks good",
        }),
        listingDraftEstimateChip(7.5).text,
        listingDraftEstimateChip(7.5).disclaimer,
      ].join("\n"),
      condition: "NM",
      askingPrice: "9.00",
      currency: "USD",
      notes: "Private: all-in was $4.04",
    });
    const outputs = [
      renderListingTitle(listingPikachu),
      descriptionStarter(listingPikachu),
      keywordChips(listingPikachu).join(" "),
      clipboard.plainText,
      clipboard.disclaimer,
      listingDraftEstimateChip(9).text,
      listingDraftEstimateChip(9).disclaimer,
      listingDraftEstimateChip(null).text,
    ];
    for (const text of outputs) expect(pregradeCopyViolations(text), text).toEqual([]);

    const fixture = JSON.parse(
      readFileSync(
        path.join(REPO, "packages", "shared", "fixtures", "listing-draft-generated-example.json"),
        "utf8",
      ),
    ) as { listingDraft: Record<string, unknown> };
    for (const text of jsonStringValues(fixture.listingDraft)) {
      expect(pregradeCopyViolations(text), text).toEqual([]);
    }
  });

  it("share-card text never uses banned estimate wording", () => {
    const outputs = [
      SHARE_CARD_COPY.collectionTitle,
      SHARE_CARD_COPY.estimateTitle,
      SHARE_CARD_COPY.estimateDisclaimer,
      shareCardVisibleCopy({ kind: "collection" }),
      shareCardVisibleCopy({ kind: "flip", bought: "4.00", sold: "9.00" }),
      shareCardVisibleCopy({ kind: "flip", bought: "4.00", sold: "9.00", estimate: 7.5 }),
      shareCardVisibleCopy({ kind: "collection", estimate: null }),
    ];
    for (const text of outputs) expect(pregradeCopyViolations(text), text).toEqual([]);
  });

  it("App Store metadata files never use banned estimate wording", () => {
    const files = sourceFiles(path.join(REPO, "apps", "mobile", "store"), /\.(json|txt|md)$/);
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const raw = readFileSync(file, "utf8");
      if (file.endsWith(".json")) {
        for (const text of jsonStringValues(JSON.parse(raw))) {
          if (pregradeCopyViolations(text).length > 0) {
            offenders.push(`${path.relative(REPO, file)}: ${text}`);
          }
        }
      } else if (pregradeCopyViolations(raw).length > 0) {
        offenders.push(path.relative(REPO, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("UX polish spec has no banned words in estimate copy", () => {
    const spec = readFileSync(path.join(REPO, "docs", "ux-polish-spec.md"), "utf8");
    expect(pregradeCopyViolations(spec)).toEqual([]);
    expect(spec).toContain("PREGRADE_COPY");
    expect(spec).toContain("Pre-grade estimate");
    expect(spec).toContain("Estimate only. Not an official grade.");
  });
});
