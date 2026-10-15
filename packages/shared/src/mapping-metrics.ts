/**
 * P1-27: weekly mapping-quality report built from the P1-26 confirm log and
 * the P1-04 unmapped set-name counter. Aggregates only, no user ids.
 */
import type { ConfirmEvent } from "./confirm-log";

export interface MappingMetricsSetRow {
  setId: string;
  confirms: number;
  corrections: number;
  manualSearches: number;
  correctionRate: number;
}

export interface MappingMetricsReport {
  from: string;
  to: string;
  confirms: number;
  top1Rate: number;
  manualSearchRate: number;
  correctionRate: number;
  /** Top pick and chosen card are in different sets: vendor → TCGdex set mapping likely off. */
  setMismatches: Array<{ predictedSetId: string; chosenSetId: string; count: number }>;
  perSet: MappingMetricsSetRow[];
  unmappedSetNames: Array<{ setName: string; source: string; count: number }>;
}

/** "base1-58" → "base1", "sv03.5-025" → "sv03.5". */
export function setIdOfTcgdexId(id: string): string {
  const cut = id.lastIndexOf("-");
  return cut > 0 ? id.slice(0, cut) : id;
}

const rate = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 1000);

export function computeMappingMetrics(input: {
  events: readonly ConfirmEvent[];
  from: string;
  to: string;
  unmappedSetNames?: ReadonlyArray<{ setName: string; source: string; count: number }>;
}): MappingMetricsReport {
  const events = input.events.filter((e) => e.at >= input.from && e.at <= input.to);
  let top1 = 0;
  let manual = 0;
  const perSet = new Map<string, MappingMetricsSetRow>();
  const mismatches = new Map<string, { predictedSetId: string; chosenSetId: string; count: number }>();
  for (const e of events) {
    const correction = e.chosenRank !== 1;
    if (!correction) top1 += 1;
    if (e.via === "manual_search") manual += 1;
    const setId = setIdOfTcgdexId(e.chosenTcgdexId);
    const row = perSet.get(setId) ?? { setId, confirms: 0, corrections: 0, manualSearches: 0, correctionRate: 0 };
    row.confirms += 1;
    if (correction) row.corrections += 1;
    if (e.via === "manual_search") row.manualSearches += 1;
    perSet.set(setId, row);
    const predicted = e.shownTcgdexIds[0];
    if (correction && predicted) {
      const predictedSetId = setIdOfTcgdexId(predicted);
      if (predictedSetId !== setId) {
        const key = `${predictedSetId}\0${setId}`;
        const m = mismatches.get(key) ?? { predictedSetId, chosenSetId: setId, count: 0 };
        m.count += 1;
        mismatches.set(key, m);
      }
    }
  }
  const rows = [...perSet.values()]
    .map((r) => ({ ...r, correctionRate: rate(r.corrections, r.confirms) }))
    .sort((a, b) => b.corrections - a.corrections || b.confirms - a.confirms || a.setId.localeCompare(b.setId));
  return {
    from: input.from,
    to: input.to,
    confirms: events.length,
    top1Rate: rate(top1, events.length),
    manualSearchRate: rate(manual, events.length),
    correctionRate: rate(events.length - top1, events.length),
    setMismatches: [...mismatches.values()].sort((a, b) => b.count - a.count),
    perSet: rows,
    unmappedSetNames: [...(input.unmappedSetNames ?? [])]
      .map(({ setName, source, count }) => ({ setName, source, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export function weeklyWindow(now: Date = new Date(), days = 7): { from: string; to: string } {
  const to = now.toISOString();
  const from = new Date(now.getTime() - days * 86_400_000).toISOString();
  return { from, to };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function mappingMetricsMarkdown(r: MappingMetricsReport, topN = 15): string {
  const lines = [
    `# Mapping quality ${r.from.slice(0, 10)} to ${r.to.slice(0, 10)}`,
    "",
    `- Confirms: ${r.confirms}`,
    `- Top-1 right: ${pct(r.top1Rate)}`,
    `- Manual search: ${pct(r.manualSearchRate)}`,
    `- Corrections: ${pct(r.correctionRate)}`,
    "",
    "## Unmapped set names",
    ...(r.unmappedSetNames.length
      ? r.unmappedSetNames.slice(0, topN).map((u) => `- ${u.setName} (${u.source}) × ${u.count}`)
      : ["- None"]),
    "",
    "## Vendor → TCGdex set mismatches",
    ...(r.setMismatches.length
      ? r.setMismatches.slice(0, topN).map((m) => `- predicted ${m.predictedSetId}, picked ${m.chosenSetId} × ${m.count}`)
      : ["- None"]),
    "",
    "## Corrections per set",
    "| Set | Confirms | Corrections | Manual search | Correction rate |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...r.perSet.slice(0, topN).map((s) => `| ${s.setId} | ${s.confirms} | ${s.corrections} | ${s.manualSearches} | ${pct(s.correctionRate)} |`),
  ];
  return lines.join("\n") + "\n";
}
