/**
 * P1-22: first-session checklist and practice mode.
 *
 * Practice mode runs entirely on the phone with bundled sample cards. It never
 * calls the API, never writes real inventory, and never spends scan or
 * pre-grade quota. Everything here is pure so it can be tested offline.
 */
import { computeMaxBuy } from "./max-buy";
import { PREGRADE_DISCLAIMER_TEXT, PREGRADE_TITLE } from "./pregrade-copy";
import type { MaxBuyComputation, MaxBuyPreferences } from "./types";

export const PRACTICE_STEP_IDS = ["scan", "max_buy", "purchased", "pregrade"] as const;
export type PracticeStepId = (typeof PRACTICE_STEP_IDS)[number];

export interface PracticeStep {
  id: PracticeStepId;
  title: string;
  hint: string;
}

export const PRACTICE_STEPS: readonly PracticeStep[] = [
  { id: "scan", title: "Scan a card", hint: "Pick a sample card to see how a scan finds it." },
  { id: "max_buy", title: "Check Max Buy", hint: "See the most you'd pay under your own rule." },
  { id: "purchased", title: "Mark Purchased", hint: "Practice cards never go into your real collection." },
  { id: "pregrade", title: `Try a ${PREGRADE_TITLE.toLowerCase()}`, hint: PREGRADE_DISCLAIMER_TEXT },
];

export const PRACTICE_COPY = {
  screenTitle: "Practice mode",
  entryLabel: "Practice with sample cards",
  checklistTitle: "Getting started",
  banner: "Practice mode. Sample cards only. Nothing is saved to your collection.",
  pickCard: "Pick a sample card",
  scanned: (name: string) => `Found ${name}`,
  purchasedToast: "Marked Purchased (practice) · Undo",
  undo: "Undo",
  done: "You're all set. Try a real scan from the Livestream Screener.",
  reset: "Start over",
  referenceLabel: "Sample reference price",
} as const;

export interface PracticeSampleCard {
  id: string;
  name: string;
  setName: string;
  number: string;
  /** Sample reference price for practice only, not a live market price. */
  referencePriceAmount: string;
  condition: string;
  /** Fixed sample estimate so the step works with no network and no quota. */
  samplePregrade: number;
}

export const PRACTICE_SAMPLE_CARDS: readonly PracticeSampleCard[] = [
  { id: "practice-base1-58", name: "Pikachu", setName: "Base Set", number: "58/102", referencePriceAmount: "12.00", condition: "Near Mint", samplePregrade: 8 },
  { id: "practice-base1-4", name: "Charizard", setName: "Base Set", number: "4/102", referencePriceAmount: "350.00", condition: "Lightly Played", samplePregrade: 6.5 },
  { id: "practice-sv3pt5-25", name: "Pikachu", setName: "151", number: "025/165", referencePriceAmount: "1.50", condition: "Near Mint", samplePregrade: 9 },
];

export function isPracticeCardId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith("practice-");
}

export interface PracticeState {
  completed: PracticeStepId[];
  selectedCardId: string | null;
  /** In-memory practice purchases. Never synced. */
  practicePurchasedIds: string[];
  completedAt: string | null;
}

export const INITIAL_PRACTICE_STATE: PracticeState = {
  completed: [],
  selectedCardId: null,
  practicePurchasedIds: [],
  completedAt: null,
};

export type PracticeAction =
  | { type: "scan"; cardId: string }
  | { type: "view_max_buy" }
  | { type: "purchase" }
  | { type: "undo_purchase" }
  | { type: "pregrade" }
  | { type: "reset" };

function markDone(state: PracticeState, step: PracticeStepId, nowIso: string): PracticeState {
  if (state.completed.includes(step)) return state;
  const completed = PRACTICE_STEP_IDS.filter((id) => id === step || state.completed.includes(id));
  return {
    ...state,
    completed,
    completedAt: completed.length === PRACTICE_STEP_IDS.length ? nowIso : state.completedAt,
  };
}

export function practiceSampleCard(id: string | null): PracticeSampleCard | null {
  return PRACTICE_SAMPLE_CARDS.find((card) => card.id === id) ?? null;
}

/** Steps unlock in order; you can't check Max Buy before you scan. */
export function nextPracticeStep(state: PracticeState): PracticeStepId | null {
  return PRACTICE_STEP_IDS.find((id) => !state.completed.includes(id)) ?? null;
}

export function practiceReducer(
  state: PracticeState,
  action: PracticeAction,
  nowIso: string = new Date().toISOString(),
): PracticeState {
  switch (action.type) {
    case "scan":
      if (!practiceSampleCard(action.cardId)) return state;
      return markDone({ ...state, selectedCardId: action.cardId }, "scan", nowIso);
    case "view_max_buy":
      if (!state.selectedCardId) return state;
      return markDone(state, "max_buy", nowIso);
    case "purchase": {
      const id = state.selectedCardId;
      if (!id || !state.completed.includes("max_buy")) return state;
      const next = state.practicePurchasedIds.includes(id)
        ? state
        : { ...state, practicePurchasedIds: [...state.practicePurchasedIds, id] };
      return markDone(next, "purchased", nowIso);
    }
    case "undo_purchase": {
      const id = state.selectedCardId;
      if (!id) return state;
      // Undo removes the practice copy but keeps the step learned.
      return { ...state, practicePurchasedIds: state.practicePurchasedIds.filter((x) => x !== id) };
    }
    case "pregrade":
      if (!state.selectedCardId || !state.completed.includes("purchased")) return state;
      return markDone(state, "pregrade", nowIso);
    case "reset":
      return INITIAL_PRACTICE_STATE;
  }
}

export function isPracticeComplete(state: PracticeState): boolean {
  return PRACTICE_STEP_IDS.every((id) => state.completed.includes(id));
}

export function practiceProgressLabel(state: PracticeState): string {
  return `${state.completed.length} of ${PRACTICE_STEP_IDS.length} done`;
}

export function practiceMaxBuy(
  card: PracticeSampleCard,
  preferences?: Partial<MaxBuyPreferences>,
): MaxBuyComputation {
  return computeMaxBuy({
    referencePriceAmount: card.referencePriceAmount,
    condition: card.condition,
    preferences,
  });
}

export function practicePregradeLines(card: PracticeSampleCard): { title: string; value: string; disclaimer: string } {
  return {
    title: `${PREGRADE_TITLE} (sample)`,
    value: `Pre-grade ${card.samplePregrade}`,
    disclaimer: PREGRADE_DISCLAIMER_TEXT,
  };
}

/** Parse persisted progress defensively; bad data starts fresh. */
export function parsePracticeState(raw: string | null | undefined): PracticeState {
  if (!raw) return INITIAL_PRACTICE_STATE;
  try {
    const value = JSON.parse(raw) as Partial<PracticeState>;
    const completed = Array.isArray(value.completed)
      ? PRACTICE_STEP_IDS.filter((id) => value.completed!.includes(id))
      : [];
    return {
      completed,
      selectedCardId: practiceSampleCard(value.selectedCardId ?? null)?.id ?? null,
      practicePurchasedIds: Array.isArray(value.practicePurchasedIds)
        ? value.practicePurchasedIds.filter((id): id is string => isPracticeCardId(id))
        : [],
      completedAt: typeof value.completedAt === "string" ? value.completedAt : null,
    };
  } catch {
    return INITIAL_PRACTICE_STATE;
  }
}
