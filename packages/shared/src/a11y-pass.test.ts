import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { changeArrow, chartSummaryLabel, signedPercent } from "./a11y-copy";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => readFileSync(path.join(REPO, rel), "utf8");

/** Scan, Grade, Confirm and Collection plus the shared controls they use. */
const SCREENS = [
  "apps/mobile/app/(tabs)/scan-tab.tsx",
  "apps/mobile/app/(tabs)/collection.tsx",
  "apps/mobile/app/(tabs)/grading.tsx",
  "apps/mobile/app/scan/[scanId].tsx",
  "apps/mobile/app/capture.tsx",
  "apps/mobile/components/ui/photo-grade-flow.tsx",
  "apps/mobile/components/ui/purchase-sheet.tsx",
  "apps/mobile/components/ui/primary-button.tsx",
  "apps/mobile/components/ui/value-history-chart.tsx",
];

describe("accessibility pass (P1-23)", () => {
  it.each(SCREENS)("every control in %s has a label and a role", (file) => {
    const src = read(file);
    const missing: string[] = [];
    for (const match of src.matchAll(/<(Pressable|TouchableOpacity|TextInput)\b([^>]*?)>/gs)) {
      const attrs = match[2] ?? "";
      const line = src.slice(0, match.index).split("\n").length;
      if (!attrs.includes("accessibilityLabel")) missing.push(`${line}: ${match[1]} label`);
      if (match[1] !== "TextInput" && !attrs.includes("accessibilityRole")) missing.push(`${line}: ${match[1]} role`);
    }
    expect(missing).toEqual([]);
  });

  it("primary buttons keep a 44 pt minimum and report disabled", () => {
    const src = read("apps/mobile/components/ui/primary-button.tsx");
    const min = Number(/minHeight:\s*(\d+)/.exec(src)?.[1]);
    expect(min).toBeGreaterThanOrEqual(44);
    expect(src).toContain("accessibilityState={{ disabled");
  });

  it("body text is never font-capped; only the big value and axis labels", () => {
    for (const file of SCREENS) {
      const src = read(file);
      expect(src).not.toContain("allowFontScaling={false}");
      if (!file.endsWith("value-history-chart.tsx")) expect(src).not.toContain("maxFontSizeMultiplier");
    }
  });

  it("the value chart has one summary label, hides its points, and shows direction without color", () => {
    const src = read("apps/mobile/components/ui/value-history-chart.tsx");
    expect(src).toContain("chartSummaryLabel(");
    expect(src).toContain('importantForAccessibility="no-hide-descendants"');
    expect(src).toContain("changeArrow(change)");
    expect(chartSummaryLabel({ todayDisplay: "$1,240.00", changePct: 6, rangeLabel: "30 days" })).toBe(
      "MyDEX value. $1,240.00 today, up 6.0% over 30 days.",
    );
    expect(chartSummaryLabel({ todayDisplay: null, changePct: null, rangeLabel: "30 days" })).toBe(
      "MyDEX value. No estimate yet.",
    );
    expect(signedPercent(-3)).toBe("\u22123.0%");
    expect(changeArrow(5)).toBe("\u25B2");
    expect(changeArrow(-5)).toBe("\u25BC");
  });
});
