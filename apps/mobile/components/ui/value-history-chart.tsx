import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import type { PortfolioHistoryPoint, PortfolioHistoryRange } from "@/lib/api";
import { colors, space } from "@/lib/theme";

/**
 * Collection value over time, drawn with plain Views (no SVG / native module).
 * Points are real recorded daily snapshots only. Fewer than two points shows no line.
 */

const CHART_HEIGHT = 120;
const LINE_THICKNESS = 2;
const DOT_SIZE = 6;
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const RANGE_OPTIONS: { range: PortfolioHistoryRange; label: string; days: number | null }[] = [
  { range: "7d", label: "7D", days: 7 },
  { range: "30d", label: "30D", days: 30 },
  { range: "90d", label: "90D", days: 90 },
  { range: "all", label: "All", days: null },
];

function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.round(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / DAY_MS);
}

function shortDate(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1] ?? ""} ${d ?? ""}`.trim();
}

function formatUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

function pointsInRange(
  points: PortfolioHistoryPoint[],
  days: number | null,
  today: string | null,
): PortfolioHistoryPoint[] {
  if (days === null || points.length === 0) return points;
  const end = dayNumber(today ?? points[points.length - 1]!.date);
  const start = end - (days - 1);
  return points.filter((point) => dayNumber(point.date) >= start);
}

interface ValueHistoryChartProps {
  /** Current `/v1/portfolio` estimate in cents, or null when there is no estimate. */
  currentCents: number | null;
  /** `portfolio.display`, e.g. "Estimate $8.25". */
  currentDisplay: string | null;
  disclaimer?: string | null;
  points: PortfolioHistoryPoint[];
  today: string | null;
  loading?: boolean;
}

export function ValueHistoryChart({
  currentCents,
  currentDisplay,
  disclaimer,
  points,
  today,
  loading,
}: ValueHistoryChartProps) {
  const [range, setRange] = useState<PortfolioHistoryRange>("30d");
  const [chartWidth, setChartWidth] = useState(0);
  const hasHistory = points.length >= 2;

  const option = RANGE_OPTIONS.find((entry) => entry.range === range) ?? RANGE_OPTIONS[3]!;
  const visible = useMemo(
    () => pointsInRange(points, option.days, today),
    [option.days, points, today],
  );

  const latestCents =
    currentCents ?? (points.length > 0 ? points[points.length - 1]!.amountCents : null);
  const first = visible[0];
  const last = visible[visible.length - 1];
  const change = visible.length >= 2 && first && last ? last.amountCents - first.amountCents : null;
  const changePct =
    change !== null && first && first.amountCents > 0 ? (change / first.amountCents) * 100 : null;
  const changeColor =
    change === null || change === 0 ? colors.muted : change > 0 ? colors.success : colors.danger;

  function onLayout(event: LayoutChangeEvent) {
    setChartWidth(event.nativeEvent.layout.width);
  }

  return (
    <View accessibilityLabel={currentDisplay ?? "Collection value"} style={styles.card}>
      <Text style={styles.label}>Collection value</Text>
      <Text style={styles.value}>
        {latestCents !== null ? formatUsd(latestCents) : loading ? "…" : "No estimate"}
      </Text>

      {hasHistory ? (
        <>
          <Text style={[styles.change, { color: changeColor }]}>
            {change === null
              ? `Not enough history for ${option.label} yet.`
              : `${change > 0 ? "+" : ""}${formatUsd(change)}${
                  changePct !== null ? ` (${change > 0 ? "+" : ""}${changePct.toFixed(1)}%)` : ""
                } · ${option.label}`}
          </Text>

          <View onLayout={onLayout} style={styles.chart}>
            {chartWidth > 0 && visible.length >= 2 ? (
              <Line points={visible} width={chartWidth} />
            ) : null}
          </View>
          {first && last && visible.length >= 2 ? (
            <View style={styles.axis}>
              <Text style={styles.axisLabel}>{shortDate(first.date)}</Text>
              <Text style={styles.axisLabel}>
                {visible.length} days recorded
              </Text>
              <Text style={styles.axisLabel}>{shortDate(last.date)}</Text>
            </View>
          ) : null}

          <View accessibilityRole="tablist" style={styles.ranges}>
            {RANGE_OPTIONS.map((entry) => {
              const selected = entry.range === range;
              return (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  key={entry.range}
                  onPress={() => setRange(entry.range)}
                  style={[styles.rangeChip, selected && styles.rangeChipSelected]}
                >
                  <Text style={[styles.rangeLabel, selected && styles.rangeLabelSelected]}>
                    {entry.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : (
        <Text style={styles.note}>
          {latestCents === null
            ? "History starts once there is an estimate."
            : points.length === 1 && today && points[0]!.date !== today
              ? `History started ${shortDate(points[0]!.date)}. A trend appears after another day.`
              : "History starts today. A trend appears after another day."}
        </Text>
      )}

      {disclaimer ? <Text style={styles.disclaimer}>{disclaimer}</Text> : null}
    </View>
  );
}

function Line({ points, width }: { points: PortfolioHistoryPoint[]; width: number }) {
  const geometry = useMemo(() => {
    const days = points.map((point) => dayNumber(point.date));
    const minDay = days[0]!;
    const spanDays = Math.max(1, days[days.length - 1]! - minDay);
    const values = points.map((point) => point.amountCents);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const spanValue = max - min;
    const pad = DOT_SIZE / 2 + 1;
    const innerW = Math.max(1, width - pad * 2);
    const innerH = CHART_HEIGHT - pad * 2;
    const coords = points.map((point, index) => ({
      x: pad + ((days[index]! - minDay) / spanDays) * innerW,
      y:
        spanValue === 0
          ? CHART_HEIGHT / 2
          : pad + (1 - (point.amountCents - min) / spanValue) * innerH,
    }));
    return { coords, min, max };
  }, [points, width]);

  const { coords, min, max } = geometry;
  return (
    <>
      <Text style={[styles.gridLabel, { top: 0 }]}>{formatUsd(max)}</Text>
      {max !== min ? (
        <Text style={[styles.gridLabel, { bottom: 0 }]}>{formatUsd(min)}</Text>
      ) : null}
      {coords.slice(1).map((end, index) => {
        const start = coords[index]!;
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);
        return (
          <View
            key={`seg-${index}`}
            style={[
              styles.segment,
              {
                width: length,
                left: (start.x + end.x) / 2 - length / 2,
                top: (start.y + end.y) / 2 - LINE_THICKNESS / 2,
                transform: [{ rotate: `${angle}rad` }],
              },
            ]}
          />
        );
      })}
      {coords.length <= 31
        ? coords.map((point, index) => (
            <View
              key={`dot-${index}`}
              style={[styles.dot, { left: point.x - DOT_SIZE / 2, top: point.y - DOT_SIZE / 2 }]}
            />
          ))
        : null}
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 16,
    padding: space.md,
    gap: space.xs,
  },
  label: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  value: { color: colors.text, fontSize: 26, fontWeight: "800" },
  change: { fontSize: 13, fontWeight: "700" },
  chart: { height: CHART_HEIGHT, marginTop: space.xs, overflow: "hidden" },
  segment: {
    position: "absolute",
    height: LINE_THICKNESS,
    borderRadius: LINE_THICKNESS / 2,
    backgroundColor: colors.accent,
  },
  dot: {
    position: "absolute",
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: colors.accent,
  },
  gridLabel: {
    position: "absolute",
    right: 0,
    color: colors.muted,
    fontSize: 11,
  },
  axis: { flexDirection: "row", justifyContent: "space-between" },
  axisLabel: { color: colors.muted, fontSize: 11 },
  ranges: { flexDirection: "row", gap: space.xs, marginTop: space.xs },
  rangeChip: {
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.chip,
  },
  rangeChipSelected: { backgroundColor: colors.accent },
  rangeLabel: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  rangeLabelSelected: { color: colors.accentText },
  note: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  disclaimer: { color: colors.muted, fontSize: 11, lineHeight: 15 },
});
