import { StyleSheet, View } from "react-native";
import { TAB_CURVE_RADIUS } from "@/components/ui/tab-bar-metrics";
import { colors } from "@/lib/theme";

export function TabBarCurve() {
  const size = TAB_CURVE_RADIUS * 2;

  return (
    <View pointerEvents="none" style={styles.row}>
      <View style={[styles.hairline, { marginTop: TAB_CURVE_RADIUS - 1 }]} />
      <View style={[styles.arcClip, { width: size, height: TAB_CURVE_RADIUS }]}>
        <View
          style={[
            styles.arc,
            {
              width: size,
              height: size,
              borderRadius: TAB_CURVE_RADIUS,
            },
          ]}
        />
      </View>
      <View style={[styles.hairline, { marginTop: TAB_CURVE_RADIUS - 1 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: TAB_CURVE_RADIUS,
    flexDirection: "row",
    alignItems: "flex-start",
    zIndex: 1,
  },
  hairline: {
    flex: 1,
    height: 1,
    backgroundColor: colors.cardBorder,
  },
  arcClip: {
    overflow: "hidden",
  },
  arc: {
    borderColor: colors.cardBorder,
    borderWidth: 1,
    backgroundColor: "transparent",
  },
});
