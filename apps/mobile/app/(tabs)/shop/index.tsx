import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { DexTile } from "@/components/shop/dex-tile";
import { SearchField } from "@/components/shop/search-field";
import { shopColors, shopSpace } from "@/components/shop/shop-theme";
import { loadNationalDex, matchesDexQuery, type DexEntry } from "@/lib/shop-dex";

export default function ShopDexScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [entries, setEntries] = useState<DexEntry[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    void loadNationalDex()
      .then((next) => {
        if (cancelled) return;
        setEntries(next);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(
    () => entries.filter((entry) => matchesDexQuery(entry, query)),
    [entries, query],
  );
  const tileWidth = (width - shopSpace.md * 2 - shopSpace.sm * 2) / 3;

  function openPokemon(entry: DexEntry) {
    router.push({
      pathname: "/shop/pokemon/[dexId]",
      params: { dexId: String(entry.dexId), name: entry.name },
    });
  }

  function retry() {
    setStatus("loading");
    void loadNationalDex()
      .then((next) => {
        setEntries(next);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }

  return (
    <View style={styles.screen}>
      <View style={styles.searchPad}>
        <SearchField
          onChangeText={setQuery}
          placeholder="Name, #, region or generation"
          value={query}
        />
      </View>
      {status === "loading" ? (
        <View style={styles.center}>
          <ActivityIndicator color={shopColors.text} />
        </View>
      ) : null}
      {status === "error" ? (
        <View style={styles.center}>
          <Text style={styles.message}>Could not load the Pokédex.</Text>
          <Pressable accessibilityRole="button" onPress={retry} style={styles.retry}>
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : null}
      {status === "ready" ? (
        <FlatList
          columnWrapperStyle={visible.length > 0 ? styles.row : undefined}
          contentContainerStyle={styles.grid}
          data={visible}
          initialNumToRender={18}
          keyboardDismissMode="on-drag"
          keyExtractor={(entry) => String(entry.dexId)}
          ListEmptyComponent={<Text style={styles.message}>No Pokémon match that search.</Text>}
          maxToRenderPerBatch={12}
          numColumns={3}
          renderItem={({ item }) => (
            <DexTile entry={item} onPress={openPokemon} width={tileWidth} />
          )}
          windowSize={7}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: shopColors.bg },
  searchPad: { padding: shopSpace.md, paddingBottom: shopSpace.sm },
  grid: { paddingHorizontal: shopSpace.md, paddingBottom: shopSpace.lg, gap: shopSpace.md },
  row: { gap: shopSpace.sm },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: shopSpace.sm },
  message: {
    color: shopColors.muted,
    fontSize: 15,
    textAlign: "center",
    padding: shopSpace.lg,
  },
  retry: {
    backgroundColor: shopColors.text,
    borderRadius: 14,
    paddingHorizontal: shopSpace.md,
    paddingVertical: shopSpace.sm,
  },
  retryLabel: { color: "#FFFFFF", fontWeight: "800" },
});
