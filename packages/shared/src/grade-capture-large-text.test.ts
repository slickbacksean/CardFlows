import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(__dirname, "../../../apps/mobile/components/ui", p), "utf8");

describe("UX large-text review fixes for PRs 68/69", () => {
  const finder = read("grade-card-finder.tsx");
  const flow = read("photo-grade-flow.tsx");
  it("finder: no % in the live text, shutter never disabled, status on the dark chip with an icon", () => {
    expect(finder).not.toMatch(/holdProgress \* 100\)\}%/);
    expect(finder).not.toMatch(/disabled=\{shutterDisabled\}/);
    expect(finder).toContain('backgroundColor: "rgba(0,0,0,0.7)"');
    expect(finder).toContain("TONE_ICONS[readiness.tone]");
    expect(finder).not.toMatch(/numberOfLines=\{1\} style=\{styles\.topTitle\}/);
  });
  it("flow: pre-grade estimate wording, one reason, Retake before Check anyway, no fixed lineHeight", () => {
    expect(flow).not.toMatch(/Grading both photos|score more reliably/);
    expect(flow).toContain("Estimating your card…");
    expect(flow).toContain("reasons[0]");
    expect(flow).not.toMatch(/lineHeight/);
    const crop = flow.slice(flow.indexOf('step === "crop"'));
    expect(crop.indexOf('label="Retake"')).toBeLessThan(crop.indexOf("PHONE_CHECK_COPY.checkAnyway"));
  });
});
