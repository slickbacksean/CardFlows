import {
  MARKETPLACE_AUTOMATION_NO_ENABLE_COPY,
  SETTINGS_RESEARCH_FLAGS,
  featureFlagStateLabel,
} from "./feature-flags";
import {
  ACCOUNT_SWITCH_CONFIRM_ACTION,
  ACCOUNT_SWITCH_CONFIRM_MESSAGE,
  ACCOUNT_SWITCH_CONFIRM_TITLE,
  ACCOUNT_SWITCH_SECTION_LABEL,
  ACCOUNT_SWITCH_STAY_ACTION,
  DEFAULT_INVITED_IDENTITY,
  INVITED_USERS,
  NOT_THIS_TESTER_LABEL,
  type InvitedIdentity,
} from "./identity";
import type { CardFlowHealth } from "./health";

/** Unsigned / no-switch Settings kicker (WIREFRAMES.md §10c). */
export const SETTINGS_KICKER = "Private beta · invited user";

export function settingsKickerForIdentity(identity: InvitedIdentity | null): string {
  return identity?.label ?? SETTINGS_KICKER;
}

export const SETTINGS_RESEARCH_SECTION_LABEL = "Research (off)";

export const SETTINGS_STACK_SECTION_LABEL = "Stack";

export const SETTINGS_STACK_STATUS_ROWS = [
  { id: "catalog", label: "Catalog" },
  { id: "recognition", label: "Capture identify" },
  { id: "livestreamIdentify", label: "Livestream identify" },
  { id: "liveIdentityVisual", label: "Livestream visual" },
  { id: "pricingProvider", label: "Pricing" },
  { id: "gradeEstimate", label: "Grade estimate" },
  { id: "slabPricing", label: "Slab comps" },
] as const;

export type SettingsStackStatusId = (typeof SETTINGS_STACK_STATUS_ROWS)[number]["id"];

export const SETTINGS_STACK_STATUS_UNAVAILABLE = "unavailable";

export const SETTINGS_STACK_STATUS_CHECKING = "Checking…";

export type SettingsStackLoad = "checking" | "ready" | "unavailable";

/** Readable Settings values. Machine ids stay on `/health`. */
const STACK_STATUS_LABELS: { [K in SettingsStackStatusId]: Record<CardFlowHealth[K], string> } = {
  catalog: {
    mock: "Mock",
    tcgdex: "TCGdex",
    pokecollector: "PokéCollector",
  },
  recognition: {
    mock: "Mock",
    obb_phash: "Photo match",
  },
  livestreamIdentify: {
    off: "Off",
    yolo_identity: "Live video",
  },
  liveIdentityVisual: {
    off: "Off",
    openclip: "OpenCLIP",
    phash: "pHash",
  },
  pricingProvider: {
    off: "Off",
    pokecollector: "PokéCollector",
  },
  gradeEstimate: {
    off: "Off",
    mock: "Mock",
    cardgrading: "Offline photo grader",
    cnn: "CNN",
  },
  slabPricing: {
    off: "Off",
    mock: "Mock",
    poketrace: "Live comps",
  },
};

export const SETTINGS_JOBS = [
  { id: "max_buy_rules", label: "Max Buy rules" },
  { id: "about", label: "About CardFlow" },
] as const;

export type SettingsJobId = (typeof SETTINGS_JOBS)[number]["id"];

const SETTINGS_HARD_NO_PATTERNS = [
  { id: "subscription", pattern: /subscription/i },
  { id: "pro", pattern: /\bpro\b/i },
  { id: "ai_grading", pattern: /ai grading/i },
  { id: "live_psa", pattern: /live psa|\bpsa\b/i },
  { id: "ebay", pattern: /ebay/i },
  { id: "whatnot", pattern: /whatnot/i },
  { id: "tcgplayer", pattern: /tcgplayer/i },
  { id: "connect_marketplace", pattern: /connect marketplace/i },
  { id: "cardsight", pattern: /cardsight/i },
  { id: "paywall", pattern: /paywall/i },
  { id: "cookie", pattern: /cookies?/i },
] as const;

/** Keys, self-host runbooks, pricing-provider fields — not the OFF research labels. */
const SETTINGS_LIVE_VENDOR_CONFIG_PATTERNS = [
  { id: "api_key", pattern: /api[_ -]?key/i },
  { id: "cardsight_key", pattern: /cardsight/i },
  { id: "anthropic", pattern: /anthropic/i },
  { id: "poketrace", pattern: /poketrace/i },
  {
    id: "tcgdex_self_host_runbook",
    pattern: /self-host|docker-compose|tcgdex\/server|setEndpoint|MAX_WORKERS/i,
  },
  {
    id: "pricing_provider_fields",
    pattern: /pricing[_ -]?endpoint|provider[_ -]?url|variants_detailed/i,
  },
] as const;

export function settingsJobLabel(id: SettingsJobId): string {
  const job = SETTINGS_JOBS.find((item) => item.id === id);
  if (!job) throw new Error(`Unknown settings job: ${id}`);
  return job.label;
}

export function settingsStackStatusValue(
  health: CardFlowHealth | null,
  id: SettingsStackStatusId,
  load: SettingsStackLoad = health ? "ready" : "unavailable",
): string {
  if (load === "checking") return SETTINGS_STACK_STATUS_CHECKING;
  if (!health || load === "unavailable") return SETTINGS_STACK_STATUS_UNAVAILABLE;
  const labels: Record<string, string> = STACK_STATUS_LABELS[id];
  return labels[health[id]] ?? health[id];
}

export function settingsVisibleCopy(): string {
  return [
    SETTINGS_KICKER,
    DEFAULT_INVITED_IDENTITY.label,
    ACCOUNT_SWITCH_SECTION_LABEL,
    ...INVITED_USERS.map((user) => user.label),
    ACCOUNT_SWITCH_CONFIRM_TITLE,
    ACCOUNT_SWITCH_CONFIRM_MESSAGE,
    ACCOUNT_SWITCH_CONFIRM_ACTION,
    ACCOUNT_SWITCH_STAY_ACTION,
    NOT_THIS_TESTER_LABEL,
    ...SETTINGS_JOBS.map((job) => job.label),
    SETTINGS_STACK_SECTION_LABEL,
    ...SETTINGS_STACK_STATUS_ROWS.map((row) => row.label),
    SETTINGS_RESEARCH_SECTION_LABEL,
    ...SETTINGS_RESEARCH_FLAGS.map(
      (flag) => `${flag.label} ${featureFlagStateLabel(flag.enabled)}`,
    ),
    MARKETPLACE_AUTOMATION_NO_ENABLE_COPY,
  ].join("\n");
}

export function forbiddenSettingsHardNo(copy: string): string | null {
  for (const item of SETTINGS_HARD_NO_PATTERNS) {
    if (item.pattern.test(copy)) return item.id;
  }
  return null;
}

export function forbiddenSettingsLiveVendorConfig(copy: string): string | null {
  for (const item of SETTINGS_LIVE_VENDOR_CONFIG_PATTERNS) {
    if (item.pattern.test(copy)) return item.id;
  }
  return null;
}
