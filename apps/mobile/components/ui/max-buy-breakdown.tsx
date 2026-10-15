import {
  MAX_BUY_BREAKDOWN_HIDE,
  MAX_BUY_BREAKDOWN_SHOW,
  MAX_BUY_BREAKDOWN_TITLE,
  maxBuyBreakdown,
  type MaxBuyComputation,
} from "@cardflow/shared";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, space } from "@/lib/theme";

/** P1-13: tap to see reference − fees − margin − condition = Max Buy. */
export function MaxBuyBreakdownToggle({
  computation,
  onEditRule,
}: {
  computation: MaxBuyComputation;
  onEditRule?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const breakdown = maxBuyBreakdown(computation);
  if (!breakdown) return null;
  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={styles.toggle}
      >
        <Text style={styles.toggleLabel}>{open ? MAX_BUY_BREAKDOWN_HIDE : MAX_BUY_BREAKDOWN_SHOW}</Text>
      </Pressable>
      {open ? (
        <View accessibilityLabel={MAX_BUY_BREAKDOWN_TITLE} style={styles.table}>
          {breakdown.lines.map((line) => {
            const total = line.id === "max_buy";
            return (
              <View
                accessibilityLabel={`${line.label} ${line.amount} dollars`}
                accessible
                key={line.id}
                style={[styles.row, total && styles.totalRow]}
              >
                <Text style={[styles.label, total && styles.total]}>{line.label}</Text>
                <Text style={[styles.amount, total && styles.total]}>
                  {line.amount.startsWith("-") ? `−$${line.amount.slice(1)}` : `$${line.amount}`}
                </Text>
              </View>
            );
          })}
          <Text style={styles.note}>{breakdown.note}</Text>
          {onEditRule ? (
            <Pressable accessibilityRole="link" onPress={onEditRule} style={styles.toggle}>
              <Text style={styles.toggleLabel}>Edit your rule</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  toggle: { minHeight: 44, justifyContent: "center" },
  toggleLabel: { color: colors.accent, fontWeight: "700", fontSize: 15 },
  table: { gap: 6 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: space.sm, flexWrap: "wrap" },
  totalRow: { borderTopWidth: 1, borderTopColor: colors.cardBorder, paddingTop: 6 },
  label: { color: colors.muted, fontSize: 15, flexShrink: 1 },
  amount: { color: colors.text, fontSize: 15, fontVariant: ["tabular-nums"] },
  total: { color: colors.text, fontWeight: "800" },
  note: { color: colors.muted, fontSize: 13, lineHeight: 18 },
});
