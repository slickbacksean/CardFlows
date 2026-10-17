import { AGE_GATE_COPY } from "@cardflow/shared";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, space } from "@/lib/theme";

/** Policy Reviewer: under 18 sees only this. No retry, no parent option, nothing else loads. */
export function AgeLockout() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.stack}>
        <Text accessibilityRole="header" style={styles.text}>
          {AGE_GATE_COPY.underAge}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  stack: { flex: 1, justifyContent: "center", padding: space.lg },
  text: { color: colors.text, fontSize: 18, lineHeight: 26, textAlign: "center" },
});
