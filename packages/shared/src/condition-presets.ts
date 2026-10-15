/**
 * P1-14: editable condition-factor presets (NM, LP, MP, HP, DMG).
 * Shown as percents in Settings, stored as factors in `conditionAdjustments`.
 * With no presets saved every condition counts at 100%, the same as before.
 */
import { CONDITION_LABELS } from "./listing-draft";

export type ConditionPresetLabel = (typeof CONDITION_LABELS)[number];
export const CONDITION_PRESET_LABELS: readonly ConditionPresetLabel[] = CONDITION_LABELS;

/** Finance's proposed starting point. Applied only when the user taps "Use suggested". */
export const SUGGESTED_CONDITION_FACTORS: Readonly<Record<ConditionPresetLabel, number>> = {
  NM: 1,
  LP: 0.85,
  MP: 0.7,
  HP: 0.5,
  DMG: 0.3,
};

export const CONDITION_PRESET_MAX_PCT = 100;
export const CONDITION_PRESET_INVALID_MESSAGE = "Each condition must be between 0 and 100%.";
export const CONDITION_PRESETS_SECTION_LABEL = "Condition (% of reference)";
export const CONDITION_PRESETS_SUGGESTED_LABEL = "Use suggested presets";
export const CONDITION_PRESETS_HELP =
  "How much of the reference price each condition is worth to you. 100% means no change.";

export type ConditionPresetForm = Record<ConditionPresetLabel, string>;

function pctString(factor: number): string {
  const pct = Math.round(factor * 1000) / 10;
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
}

export function conditionPresetsToForm(
  adjustments: Record<string, number> | null | undefined,
): ConditionPresetForm {
  const form = {} as ConditionPresetForm;
  for (const label of CONDITION_PRESET_LABELS) {
    const factor = adjustments?.[label];
    form[label] = pctString(typeof factor === "number" && Number.isFinite(factor) && factor >= 0 ? factor : 1);
  }
  return form;
}

export function suggestedConditionPresetsForm(): ConditionPresetForm {
  return conditionPresetsToForm(SUGGESTED_CONDITION_FACTORS);
}

/**
 * Percent form → stored factors. Keeps any non-preset keys the user already
 * had. All-100% with nothing else stored becomes null (no change from before).
 */
export function parseConditionPresetsForm(
  form: Partial<Record<ConditionPresetLabel, string>>,
  existing?: Record<string, number> | null,
): { ok: true; conditionAdjustments: Record<string, number> | null } | { ok: false; error: string } {
  const next: Record<string, number> = {};
  for (const [key, value] of Object.entries(existing ?? {})) {
    if (!(CONDITION_PRESET_LABELS as readonly string[]).includes(key)) next[key] = value;
  }
  for (const label of CONDITION_PRESET_LABELS) {
    const raw = (form[label] ?? "").trim().replace(/%$/, "");
    const pct = raw === "" ? 100 : Number(raw);
    if (!Number.isFinite(pct) || pct < 0 || pct > CONDITION_PRESET_MAX_PCT) {
      return { ok: false, error: CONDITION_PRESET_INVALID_MESSAGE };
    }
    next[label] = Math.round(pct * 10) / 1000;
  }
  const extraKeys = Object.keys(next).filter((k) => !(CONDITION_PRESET_LABELS as readonly string[]).includes(k));
  const allDefault = CONDITION_PRESET_LABELS.every((label) => next[label] === 1);
  return { ok: true, conditionAdjustments: allDefault && extraKeys.length === 0 ? null : next };
}
