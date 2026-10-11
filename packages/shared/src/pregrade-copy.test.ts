import { readdirSync, readFileSync, statSync } from "node:fs";
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
import { PREGRADE_DISCLAIMER, PREGRADE_LABEL, PREGRADE_SURFACE_NULL_REASON } from "./photo-pregrade";
import { PREGRADE_COPY, pregradeCopyViolations } from "./pregrade-copy";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe("pre-grade copy", () => {
  it("uses the standing title and disclaimer everywhere", () => {
    expect(PREGRADE_LABEL).toBe("Pre-grade estimate");
    expect(PREGRADE_DISCLAIMER).toBe("Estimate only. Not an official grade.");
    expect(GRADE_ESTIMATE_DISCLAIMER).toBe(PREGRADE_DISCLAIMER);
    expect(PREGRADE_SURFACE_NULL_REASON).toBe("Surface not assessed from a single photo.");
  });

  it("never says AI or names a grading company", () => {
    const strings = [
      ...Object.values(PREGRADE_COPY),
      GRADE_ESTIMATE_DISCLAIMER,
      GRADE_ESTIMATE_NEEDS_BACK_COPY,
      GRADE_PHOTOS_HINT,
      GRADING_TAB_CONSTRAINT,
    ];
    for (const text of strings) expect(pregradeCopyViolations(text), text).toEqual([]);
  });

  it("rewrites estimates saved with the old copy", () => {
    const stored = parseStoredGradeEstimate(
      JSON.stringify({ notACert: true, overall: 7.5, display: "AI pre-grade 7.5" }),
    );
    expect(stored?.display).toBe("Pre-grade 7.5");
    expect(stored?.disclaimer).toBe("Estimate only. Not an official grade.");
  });

  it("grading screens and the pre-grade API have no AI or company names in quoted copy", () => {
    const files = [
      ...sourceFiles(path.join(REPO, "apps", "mobile", "components", "ui")).filter((file) =>
        /(photo-grade-flow|grade-camera|prepare-sheet|returned-sheet|submitted-sheet)\.tsx$/.test(file),
      ),
      path.join(REPO, "apps", "mobile", "app", "(tabs)", "grading.tsx"),
      path.join(REPO, "apps", "api", "src", "cardgrading-map.ts"),
      path.join(REPO, "apps", "api", "src", "grade-photo-flow.ts"),
    ];
    const offenders: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        // Only quoted strings and JSX text are user-facing.
        const quoted = line.match(/"[^"]*"|'[^']*'|`[^`]*`|>[^<>{}]+</g) ?? [];
        for (const chunk of quoted) {
          if (pregradeCopyViolations(chunk).length > 0) {
            offenders.push(`${path.relative(REPO, file)}:${index + 1}: ${chunk}`);
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
