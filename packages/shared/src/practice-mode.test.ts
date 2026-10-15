import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  INITIAL_PRACTICE_STATE,
  PRACTICE_COPY,
  PRACTICE_SAMPLE_CARDS,
  PRACTICE_STEPS,
  isPracticeComplete,
  nextPracticeStep,
  parsePracticeState,
  practiceMaxBuy,
  practicePregradeLines,
  practiceReducer,
  type PracticeAction,
  type PracticeState,
} from "./practice-mode";

const here = dirname(fileURLToPath(import.meta.url));
const run = (actions: PracticeAction[], start: PracticeState = INITIAL_PRACTICE_STATE) =>
  actions.reduce((s, a) => practiceReducer(s, a, "2026-10-14T00:00:00.000Z"), start);

describe("practice mode", () => {
  it("walks scan → Max Buy → Purchased → pre-grade estimate", () => {
    const card = PRACTICE_SAMPLE_CARDS[0]!;
    const done = run([
      { type: "scan", cardId: card.id },
      { type: "view_max_buy" },
      { type: "purchase" },
      { type: "undo_purchase" },
      { type: "purchase" },
      { type: "pregrade" },
    ]);
    expect(isPracticeComplete(done)).toBe(true);
    expect(done.completedAt).toBe("2026-10-14T00:00:00.000Z");
    expect(done.practicePurchasedIds).toEqual([card.id]);
    expect(nextPracticeStep(done)).toBeNull();
  });

  it("keeps steps in order", () => {
    const s = run([{ type: "view_max_buy" }, { type: "purchase" }, { type: "pregrade" }]);
    expect(s.completed).toEqual([]);
    expect(nextPracticeStep(s)).toBe("scan");
    expect(run([{ type: "scan", cardId: "base1-58" }]).completed).toEqual([]);
  });

  it("computes Max Buy offline from the sample reference price", () => {
    const m = practiceMaxBuy(PRACTICE_SAMPLE_CARDS[0]!, { targetMarginPct: 30, feesBufferPct: 10 });
    expect(m.maxBuyAmount).not.toBeNull();
    expect(m.referencePriceSource).toBe("user_entered");
  });

  it("uses only the approved estimate copy", () => {
    const lines = practicePregradeLines(PRACTICE_SAMPLE_CARDS[1]!);
    expect(lines.disclaimer).toBe("Estimate only. Not an official grade.");
    expect(lines.title).toContain("Pre-grade estimate");
    const all = JSON.stringify({ PRACTICE_COPY, PRACTICE_STEPS, lines, PRACTICE_SAMPLE_CARDS });
    expect(all).not.toMatch(/\bAI\b|PSA|BGS|CGC/);
  });

  it("restores saved progress and drops bad data", () => {
    expect(parsePracticeState("{bad")).toEqual(INITIAL_PRACTICE_STATE);
    const s = parsePracticeState(
      JSON.stringify({ completed: ["max_buy", "scan", "x"], selectedCardId: "nope", practicePurchasedIds: ["real-1", "practice-base1-4"] }),
    );
    expect(s.completed).toEqual(["scan", "max_buy"]);
    expect(s.selectedCardId).toBeNull();
    expect(s.practicePurchasedIds).toEqual(["practice-base1-4"]);
  });

  it("practice screen never calls the API or real inventory", () => {
    const screen = readFileSync(resolve(here, "../../../apps/mobile/app/practice.tsx"), "utf8");
    expect(screen).not.toMatch(/@\/lib\/api|fetch\(|inventory|grade-photos|\bAI\b|PSA|BGS|CGC/);
  });
});
