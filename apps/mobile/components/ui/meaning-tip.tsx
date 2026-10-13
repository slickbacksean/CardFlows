import { WHAT_THIS_MEANS_LABEL } from "@cardflow/shared";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "@/lib/theme";

interface MeaningTipProps {
  tip: string;
}

export function MeaningTip({ tip }: MeaningTipProps) {
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityLabel={WHAT_THIS_MEANS_LABEL}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        hitSlop={8}
        onPress={() => setOpen((value) => !value)}
        style={styles.trigger}
      >
        <Ionicons
          color={colors.accent}
          name={open ? "close-circle-outline" : "help-circle-outline"}
          size={18}
        />
        <Text style={styles.triggerLabel}>{WHAT_THIS_MEANS_LABEL}</Text>
      </Pressable>
      {open ? (
        <Text accessibilityRole="text" style={styles.tip}>
          {tip}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  trigger: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
  },
  triggerLabel: { color: colors.accent, fontSize: 13, fontWeight: "700" },
  tip: { color: colors.muted, fontSize: 14, lineHeight: 20 },
});
