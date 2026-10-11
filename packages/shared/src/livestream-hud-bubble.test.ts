import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LIVESTREAM_HUD_BUBBLE_COLLAPSED_SIZE,
  LIVESTREAM_HUD_BUBBLE_EXPANDED_HEIGHT,
  LIVESTREAM_HUD_BUBBLE_EXPANDED_WIDTH,
  LIVESTREAM_HUD_BUBBLE_INSET,
  clampLivestreamHudBubbleOffset,
  livestreamHudBubbleSize,
} from "./livestream-hud";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("Livestream HUD floating bubble", () => {
  it("clamps a dragged bubble to the live region inset", () => {
    expect(livestreamHudBubbleSize(false)).toEqual({
      width: LIVESTREAM_HUD_BUBBLE_COLLAPSED_SIZE,
      height: LIVESTREAM_HUD_BUBBLE_COLLAPSED_SIZE,
    });
    expect(livestreamHudBubbleSize(true).width).toBe(LIVESTREAM_HUD_BUBBLE_EXPANDED_WIDTH);
    expect(livestreamHudBubbleSize(true).height).toBe(LIVESTREAM_HUD_BUBBLE_EXPANDED_HEIGHT);

    expect(
      clampLivestreamHudBubbleOffset({
        x: -40,
        y: -12,
        parentWidth: 390,
        parentHeight: 700,
        bubbleWidth: LIVESTREAM_HUD_BUBBLE_COLLAPSED_SIZE,
        bubbleHeight: LIVESTREAM_HUD_BUBBLE_COLLAPSED_SIZE,
      }),
    ).toEqual({ x: LIVESTREAM_HUD_BUBBLE_INSET, y: LIVESTREAM_HUD_BUBBLE_INSET });

    expect(
      clampLivestreamHudBubbleOffset({
        x: 800,
        y: 800,
        parentWidth: 390,
        parentHeight: 700,
        bubbleWidth: LIVESTREAM_HUD_BUBBLE_EXPANDED_WIDTH,
        bubbleHeight: LIVESTREAM_HUD_BUBBLE_EXPANDED_HEIGHT,
      }),
    ).toEqual({
      x: 390 - LIVESTREAM_HUD_BUBBLE_EXPANDED_WIDTH - LIVESTREAM_HUD_BUBBLE_INSET,
      y: 700 - LIVESTREAM_HUD_BUBBLE_EXPANDED_HEIGHT - LIVESTREAM_HUD_BUBBLE_INSET,
    });
  });

  it("renders a floating bubble over the live page instead of a full-width strip", () => {
    const overlay = readRepoFile("apps/mobile/components/ui/screener-overlay.tsx");
    const scanTab = readRepoFile("apps/mobile/app/(tabs)/scan-tab.tsx");
    const html = readRepoFile("infra/huds/overlay/index.html");
    const css = readRepoFile("infra/huds/overlay/overlay.css");
    const js = readRepoFile("infra/huds/overlay/overlay.js");

    expect(overlay).toContain("LIVESTREAM_HUD_BUBBLE_COLLAPSED_SIZE");
    expect(overlay).toContain("clampLivestreamHudBubbleOffset");
    expect(overlay).toContain("GestureDetector");
    expect(overlay).toContain("accessibilityLabel=\"CardFlow overlay bubble\"");
    expect(overlay).toContain("Expand CardFlow overlay");
    expect(overlay).toContain("Collapse CardFlow overlay");
    expect(overlay).not.toContain("hudBand");
    expect(overlay).not.toMatch(/width:\s*["']100%["']/);
    expect(scanTab).toContain("hudLayer");
    expect(scanTab).toContain("bottom: 0");
    expect(html).toContain('class="bubble"');
    expect(css).toContain(".bubble");
    expect(css).toContain("border-radius");
    expect(css).toContain("transparent");
    expect(js).toContain('setAttribute("data-kind"');
    expect(`${html}\n${css}\n${js}`).not.toMatch(/whatnot|ebay|inject|scrape|screenshot/i);
  });
});
