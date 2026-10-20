import { dexProgressLabel, type DexSetSummary } from "@cardflow/shared";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { PreferencesScreenHeader } from "@/components/ui/preferences-screen-header";
import { ScreenError, ScreenLoading } from "@/components/ui/screen-state";
import { listDexSets } from "@/lib/api";
import { colors, space } from "@/lib/theme";

/** MyDEX by set: pick a set to see every card, owned in color and the rest greyed. */
export default function DexSetsScreen() {
  const router = useRouter();
  const [sets, setSets] = useState<DexSetSummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [filter, setFilter] = useState("");

  const [attempt, setAttempt] = useState(0);
  const load = useCallback(() => setAttempt((n) => n + 1), []);
  useEffect(() => {
    let alive = true;
    listDexSets()
      .then((result) => {
        if (!alive) return;
        setError(null);
        setSets(result.sets);
      })
      .catch((e: unknown) => {
        if (alive) setError(e ?? new Error("load failed"));
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const list = sets ?? [];
    const filtered = needle ? list.filter((s) => s.name.toLowerCase().includes(needle)) : list;
    // Sets you've started first, then the rest in catalog order.
    return [...filtered].sort((a, b) => Number(b.owned > 0) - Number(a.owned > 0));
  }, [filter, sets]);

  return (
    <View style={styles.flex}>
      <PreferencesScreenHeader dismiss="back" title="MyDEX by set" />
      {error ? (
        <ScreenError error={error} onRetry={load} what="sets" />
      ) : !sets ? (
        <ScreenLoading label="Loading sets" />
      ) : (
        <FlatList
          ListHeaderComponent={
            <TextInput
              accessibilityLabel="Find a set"
              onChangeText={setFilter}
              placeholder="Find a set"
              placeholderTextColor={colors.muted}
              style={styles.search}
              value={filter}
            />
          }
          data={shown}
          initialNumToRender={20}
          keyExtractor={(item) => item.setId}
          renderItem={({ item }) => (
            <Pressable
              accessibilityLabel={`${item.name}, ${item.owned} of ${item.total} owned`}
              accessibilityRole="button"
              onPress={() => router.push(`/dex/${item.setId}`)}
              style={styles.row}
            >
              <Text numberOfLines={1} style={styles.name}>
                {item.name}
              </Text>
              <Text style={styles.count}>{dexProgressLabel(item.owned, item.total)}</Text>
            </Pressable>
          )}
          windowSize={7}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  search: {
    margin: space.md,
    padding: space.sm,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.muted,
    color: colors.text,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.muted,
  },
  name: { flex: 1, color: colors.text, fontSize: 16 },
  count: { color: colors.muted, fontVariant: ["tabular-nums"] },
});
