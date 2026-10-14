import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, space } from "@/lib/theme";
import { MeaningTip } from "./meaning-tip";

interface LabeledFigureProps {
  label: string;
  tip: string;
  children: ReactNode;
}

export function LabeledFigure({ label, tip, children }: LabeledFigureProps) {
  return (
    <View style={styles.block}>
      <Text style={styles.label}>{label}</Text>
      {children}
      <MeaningTip tip={tip} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: 8,
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 16,
    padding: space.md,
  },
  label: { color: colors.text, fontWeight: "700", fontSize: 15 },
});
