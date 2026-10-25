import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, ActivityIndicator } from "react-native";
import { colors, radii, space } from "@/lib/theme";

type Segment = "market" | "feed";

export default function CommunityScreen() {
  const [segment, setSegment] = useState<Segment>("market");
  const [loading, setLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      // TODO: Load community data
    }, [])
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Community</Text>
        <Pressable
          accessibilityLabel="Community settings"
          accessibilityRole="button"
          onPress={() => router.push("/community-settings")}
          style={styles.settingsButton}
        >
          <Ionicons color={colors.muted} name="settings-outline" size={24} />
        </Pressable>
      </View>

      <View style={styles.segments}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: segment === "market" }}
          onPress={() => setSegment("market")}
          style={[styles.segmentButton, segment === "market" && styles.segmentButtonActive]}
        >
          <Text style={[styles.segmentText, segment === "market" && styles.segmentTextActive]}>
            Market
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: segment === "feed" }}
          onPress={() => setSegment("feed")}
          style={[styles.segmentButton, segment === "feed" && styles.segmentButtonActive]}
        >
          <Text style={[styles.segmentText, segment === "feed" && styles.segmentTextActive]}>
            Feed
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} style={styles.scrollView}>
        {segment === "market" ? <MarketContent /> : <FeedContent />}
      </ScrollView>
    </View>
  );
}

function MarketContent() {
  return (
    <View style={styles.placeholder}>
      <Text style={styles.placeholderTitle}>Market Coming Soon</Text>
      <Text style={styles.placeholderBody}>
        See biggest movers, what's buying, what's selling, and set trends.
      </Text>
      <Text style={styles.footer}>
        Prices are estimates from public sales data. Not financial advice. Past prices don't predict
        future value.
      </Text>
    </View>
  );
}

function FeedContent() {
  return (
    <View style={styles.placeholder}>
      <Text style={styles.placeholderTitle}>Feed Coming Soon</Text>
      <Text style={styles.placeholderBody}>
        Share your pulls, react to others, and comment. Sharing is off by default.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  title: { color: colors.text, fontSize: 28, fontWeight: "800", letterSpacing: -0.6 },
  settingsButton: { padding: 8 },
  segments: {
    flexDirection: "row",
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.cardBorder,
  },
  segmentButton: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radii.pill,
  },
  segmentButtonActive: { backgroundColor: colors.accent },
  segmentText: { color: colors.muted, fontSize: 15, fontWeight: "700" },
  segmentTextActive: { color: colors.accentText },
  scrollView: { flex: 1 },
  content: { padding: space.lg, gap: space.md },
  placeholder: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, paddingVertical: 80 },
  placeholderTitle: { color: colors.text, fontSize: 20, fontWeight: "800" },
  placeholderBody: { color: colors.muted, fontSize: 15, textAlign: "center", maxWidth: 280, lineHeight: 22 },
  footer: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: space.xl },
});
