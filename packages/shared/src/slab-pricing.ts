import { CONDITION_LABELS } from "./listing-draft";
import { centsToDollarString, dollarsToCents } from "./money";

export const SLAB_COMPANIES = ["PSA", "BGS", "CGC", "TAG"] as const;
export type SlabCompany = (typeof SLAB_COMPANIES)[number];

export const PREPARE_SLAB_ROWS = [
  { company: "PSA", grade: "8" },
  { company: "PSA", grade: "9" },
  { company: "PSA", grade: "10" },
  { company: "BGS", grade: "9.5" },
  { company: "CGC", grade: "10" },
  { company: "TAG", grade: "10" },
] as const;

/** Free-plan Prepare rows. Graded PSA/BGS/CGC/TAG comps stay in PREPARE_SLAB_ROWS for a later Pro plan. */
export const PREPARE_RAW_ROWS = CONDITION_LABELS;

export const SLAB_PRICE_LABEL = "estimate" as const;
export const SLAB_PRICE_DISCLAIMER = "Raw sales estimate. Not a bid." as const;
export const SLAB_PRICE_EMPTY_COPY = "No raw estimate." as const;
export const POKETRACE_PUBLIC_ENDPOINT = "https://api.poketrace.com/v1";
export const POKETRACE_GRADED_DOCS_URL = "https://poketrace.com/docs/graded-prices";

const POKETRACE_RAW_TIERS: Record<string, (typeof PREPARE_RAW_ROWS)[number]> = {
  NEAR_MINT: "NM",
  LIGHTLY_PLAYED: "LP",
  MODERATELY_PLAYED: "MP",
  HEAVILY_PLAYED: "HP",
  DAMAGED: "DMG",
};

export interface SlabGradePrice {
  company: SlabCompany;
  grade: string;
  amountCents: number | null;
  amount: string | null;
  display: string;
}

export interface SlabRawPrice {
  condition: (typeof PREPARE_RAW_ROWS)[number];
  amountCents: number | null;
  amount: string | null;
  display: string;
}

export type SlabPricingSource = "poketrace" | "mock" | "none";
export type SlabPricingProviderName = "poketrace" | "mock" | "off";

export interface SlabGradedTier {
  company: SlabCompany;
  grade: string;
}

export interface CardFlowSlabEstimate {
  tcgdexId: string;
  currency: "USD";
  rawRows: SlabRawPrice[];
  rows: SlabGradePrice[];
  /** Highest graded sale when per-grade amounts are not in the response. */
  topAmountCents: number | null;
  topAmount: string | null;
  /** Graded tiers that have sales, even when each tier's price is plan-filtered. */
  gradedTiers: SlabGradedTier[];
  source: SlabPricingSource;
  label: typeof SLAB_PRICE_LABEL;
  notAMarket: true;
  notABid: true;
  display: string;
  disclaimer: string;
}

export interface SlabEstimateRequest {
  tcgdexId: string;
  language?: "en";
  name?: string | null;
  localId?: string | null;
  setId?: string | null;
  setName?: string | null;
}

export interface SlabPricingProvider {
  readonly name: SlabPricingProviderName;
  getSlabEstimates(req: SlabEstimateRequest): Promise<CardFlowSlabEstimate>;
}

export const TYPICAL_GRADING_FEES = [
  { company: "PSA", name: "Regular", feeUsd: 50 },
  { company: "BGS", name: "Standard", feeUsd: 50 },
  { company: "CGC", name: "Standard", feeUsd: 20 },
  { company: "TAG", name: "Standard", feeUsd: 20 },
] as const;

export function emptySlabRow(company: SlabCompany, grade: string): SlabGradePrice {
  return {
    company,
    grade,
    amountCents: null,
    amount: null,
    display: "—",
  };
}

export function emptyRawRow(condition: SlabRawPrice["condition"]): SlabRawPrice {
  return {
    condition,
    amountCents: null,
    amount: null,
    display: "—",
  };
}

export function emptySlabEstimate(
  tcgdexId: string,
  source: SlabPricingSource = "none",
): CardFlowSlabEstimate {
  return {
    tcgdexId,
    currency: "USD",
    rawRows: PREPARE_RAW_ROWS.map((condition) => emptyRawRow(condition)),
    rows: PREPARE_SLAB_ROWS.map((row) => emptySlabRow(row.company, row.grade)),
    topAmountCents: null,
    topAmount: null,
    gradedTiers: [],
    source,
    label: SLAB_PRICE_LABEL,
    notAMarket: true,
    notABid: true,
    display: SLAB_PRICE_EMPTY_COPY,
    disclaimer: SLAB_PRICE_DISCLAIMER,
  };
}

export function parsePoketraceRawTier(
  tier: string,
): SlabRawPrice["condition"] | null {
  return POKETRACE_RAW_TIERS[tier.trim().toUpperCase().replace(/-/g, "_")] ?? null;
}

export function parsePoketraceTier(
  tier: string,
): { company: SlabCompany; grade: string } | null {
  const normalized = tier.trim().toUpperCase().replace(/-/g, "_");
  const company = SLAB_COMPANIES.find((name) => normalized.startsWith(`${name}_`));
  if (!company) return null;
  const rest = normalized.slice(company.length + 1);
  if (!rest) return null;
  const grade = rest.replace("_", ".");
  if (!/^\d+(\.\d+)?$/.test(grade)) return null;
  return { company, grade };
}

export function slabRowFromUsd(
  company: SlabCompany,
  grade: string,
  usd: number,
): SlabGradePrice {
  if (!Number.isFinite(usd) || usd <= 0) return emptySlabRow(company, grade);
  const amountCents = dollarsToCents(usd);
  const amount = centsToDollarString(amountCents);
  return {
    company,
    grade,
    amountCents,
    amount,
    display: `$${amount}`,
  };
}

export function rawRowFromUsd(
  condition: SlabRawPrice["condition"],
  usd: number,
): SlabRawPrice {
  if (!Number.isFinite(usd) || usd <= 0) return emptyRawRow(condition);
  const amountCents = dollarsToCents(usd);
  const amount = centsToDollarString(amountCents);
  return {
    condition,
    amountCents,
    amount,
    display: `$${amount}`,
  };
}

export function pickPrepareRawRows(found: readonly SlabRawPrice[]): SlabRawPrice[] {
  return PREPARE_RAW_ROWS.map((condition) => {
    const match = found.find((row) => row.condition === condition);
    return match ?? emptyRawRow(condition);
  });
}

export function pickPrepareSlabRows(found: readonly SlabGradePrice[]): SlabGradePrice[] {
  return PREPARE_SLAB_ROWS.map((slot) => {
    const match = found.find(
      (row) => row.company === slot.company && row.grade === slot.grade,
    );
    return match ?? emptySlabRow(slot.company, slot.grade);
  });
}

interface PoketraceTierPrice {
  avg?: unknown;
  avg1d?: unknown;
  avg7d?: unknown;
  avg30d?: unknown;
  median3d?: unknown;
  median7d?: unknown;
  median30d?: unknown;
}

function firstPositiveUsd(
  tier: PoketraceTierPrice | undefined,
  kind: "raw" | "graded",
): number | null {
  if (!tier) return null;
  const values =
    kind === "graded"
      ? [tier.avg, tier.avg7d, tier.avg30d, tier.avg1d, tier.median7d, tier.median30d, tier.median3d]
      : [tier.median7d, tier.avg, tier.median30d, tier.avg7d, tier.avg30d, tier.median3d, tier.avg1d];
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

export function hasPrepareMarketAmounts(estimate: CardFlowSlabEstimate): boolean {
  return (
    estimate.rawRows.some((row) => row.amountCents !== null) ||
    estimate.rows.some((row) => row.amountCents !== null)
  );
}

export function hasPrepareGradedAmounts(estimate: CardFlowSlabEstimate): boolean {
  return estimate.rows.some((row) => row.amountCents !== null);
}

export function applyGradedMarketSummary(
  estimate: CardFlowSlabEstimate,
  input: { topPrice?: number | null; gradedOptions?: readonly string[] | null },
): CardFlowSlabEstimate {
  const topPrice =
    typeof input.topPrice === "number" && Number.isFinite(input.topPrice) && input.topPrice > 0
      ? input.topPrice
      : null;
  const seen = new Set<string>();
  const gradedTiers: SlabGradedTier[] = [];
  for (const option of input.gradedOptions ?? []) {
    const parsed = parsePoketraceTier(option);
    if (!parsed) continue;
    const key = `${parsed.company}:${parsed.grade}`;
    if (seen.has(key)) continue;
    seen.add(key);
    gradedTiers.push(parsed);
  }
  if (topPrice === null && gradedTiers.length === 0) return estimate;
  const topAmountCents = topPrice === null ? null : dollarsToCents(topPrice);
  return {
    ...estimate,
    topAmountCents,
    topAmount: topAmountCents === null ? null : centsToDollarString(topAmountCents),
    gradedTiers,
    source: estimate.source === "none" ? "poketrace" : estimate.source,
    display: estimate.source === "none" ? "Estimate" : estimate.display,
  };
}

export function slabEstimatesFromPoketracePrices(
  tcgdexId: string,
  prices: Record<string, Record<string, PoketraceTierPrice | undefined>> | null | undefined,
  source: Exclude<SlabPricingSource, "none"> = "poketrace",
): CardFlowSlabEstimate {
  const empty = emptySlabEstimate(tcgdexId, "none");
  if (!prices) return empty;

  const preferred = ["ebay", "tcgplayer", "cardmarket"];
  const sourceNames = [
    ...preferred.filter((name) => name in prices),
    ...Object.keys(prices).filter((name) => !preferred.includes(name)),
  ];
  const foundRaw: SlabRawPrice[] = [];
  const found: SlabGradePrice[] = [];
  for (const sourceName of sourceNames) {
    const tiers = prices[sourceName];
    if (!tiers) continue;
    for (const [tier, data] of Object.entries(tiers)) {
      const raw = parsePoketraceRawTier(tier);
      const parsed = raw ? null : parsePoketraceTier(tier);
      if (!raw && !parsed) continue;
      const usd = firstPositiveUsd(data, raw ? "raw" : "graded");
      if (usd === null) continue;
      if (raw && !foundRaw.some((row) => row.condition === raw)) {
        foundRaw.push(rawRowFromUsd(raw, usd));
        continue;
      }
      if (!parsed) continue;
      if (found.some((row) => row.company === parsed.company && row.grade === parsed.grade)) {
        continue;
      }
      found.push(slabRowFromUsd(parsed.company, parsed.grade, usd));
    }
  }

  const rawRows = pickPrepareRawRows(foundRaw);
  const prepareRows = pickPrepareSlabRows(found);
  const rows = [
    ...prepareRows,
    ...found.filter(
      (row) =>
        !PREPARE_SLAB_ROWS.some((slot) => slot.company === row.company && slot.grade === row.grade),
    ),
  ];
  const estimate = {
    ...empty,
    rawRows,
    rows,
    source,
    display: "Estimate",
  };
  if (!hasPrepareMarketAmounts(estimate)) return empty;
  return { ...estimate, source };
}

export function typicalGradingFeeNote(company: string | null | undefined): string {
  const needle = company?.trim().toLowerCase() ?? "";
  const match = TYPICAL_GRADING_FEES.find((row) => needle.includes(row.company.toLowerCase()));
  const row = match ?? TYPICAL_GRADING_FEES[0];
  return `Typical ${row.company} ${row.name} fee $${row.feeUsd} — not live.`;
}

export function slabRowLabel(row: SlabGradePrice): string {
  return `${row.company} ${row.grade}`;
}

export function rawRowLabel(row: SlabRawPrice): string {
  return row.condition;
}

export const offSlabPricingProvider: SlabPricingProvider = {
  name: "off",
  async getSlabEstimates(req) {
    return emptySlabEstimate(req.tcgdexId, "none");
  },
};

export function createOffSlabPricingProvider(): SlabPricingProvider {
  return offSlabPricingProvider;
}

export function createMockSlabPricingProvider(
  found: readonly SlabGradePrice[] = [slabRowFromUsd("PSA", "10", 120)],
  foundRaw: readonly SlabRawPrice[] = [rawRowFromUsd("NM", 12)],
): SlabPricingProvider {
  return {
    name: "mock",
    async getSlabEstimates(req) {
      const rawRows = pickPrepareRawRows(foundRaw);
      const rows = pickPrepareSlabRows(found);
      const estimate = {
        ...emptySlabEstimate(req.tcgdexId, "mock"),
        rawRows,
        rows,
        source: "mock" as const,
        display: "Estimate",
      };
      if (!hasPrepareMarketAmounts(estimate)) return emptySlabEstimate(req.tcgdexId);
      return estimate;
    },
  };
}
