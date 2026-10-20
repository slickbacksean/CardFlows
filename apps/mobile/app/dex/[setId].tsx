import { dexProgressLabel, dexTileTone, type DexCard, type DexSetView } from "@cardflow/shared";
import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { memo, useCallback, useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { PreferencesScreenHeader } from "@/components/ui/preferences-screen-header";
import { ScreenError, ScreenLoading } from "@/components/ui/screen-state";
import { getDexSet } from "@/lib/api";
import { colors, space } from "@/lib/theme";

const COLUMNS = 3;

/** Every English card in the set, official catalog art. Owned = full color, unowned = greyed. */
export default function DexSetScreen() {
  const { setId } = useLocalSearchParams<{ setId: string }>();
  const [set, setSet] = useState<DexSetView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const { width } = useWindowDimensions();
  const tileWidth = Math.floor((width - space.md * 2 - space.sm * (COLUMNS - 1)) / COLUMNS);

  const [attempt, setAttempt] = useState(0);
  const load = useCallback(() => setAttempt((n) => n + 1), []);
  useEffect(() => {
    if (!setId) return;
    let alive = true;
    getDexSet(String(setId))
      .then((result) => {
        if (!alive) return;
        setError(null);
        setSet(result.set);
      })
      .catch((e: unknown) => {
        if (alive) setError(e ?? new Error("load failed"));
      });
    return () => {
      alive = false;
    };
  }, [attempt, setId]);

  return (
    <View style={styles.flex}>
      <PreferencesScreenHeader
        dismiss="back"
        title={set ? `${set.name} · ${dexProgressLabel(set.owned, set.total)}` : "Set"}
      />
      {error ? (
        <ScreenError error={error} onRetry={load} what="this set" />
      ) : !set ? (
        <ScreenLoading label="Loading set" />
      ) : (
        <FlatList
          columnWrapperStyle={styles.columns}
          contentContainerStyle={styles.content}
          data={set.cards}
          getItemLayout={(_, index) => {
            const rowHeight = Math.round(tileWidth * 1.4) + 28 + space.sm;
            const row = Math.floor(index / COLUMNS);
            return { length: rowHeight, offset: rowHeight * row, index };
          }}
          initialNumToRender={18}
          keyExtractor={(card) => card.tcgdexId}
          maxToRenderPerBatch={18}
          numColumns={COLUMNS}
          removeClippedSubviews
          renderItem={({ item }) => <DexTile card={item} width={tileWidth} />}
          windowSize={5}
        />
      )}
    </View>
  );
}

const DexTile = memo(function DexTile({ card, width }: { card: DexCard; width: number }) {
  const tone = dexTileTone(card.owned);
  return (
    <View
      accessibilityLabel={`${card.name} ${card.localId}, ${card.owned ? "owned" : "not owned"}`}
      style={[styles.tile, { width, opacity: tone.opacity }]}
    >
      {card.thumbUrl ? (
        <Image
          accessibilityIgnoresInvertColors
          cachePolicy="memory-disk"
          contentFit="contain"
          recyclingKey={card.tcgdexId}
          source={{ uri: card.thumbUrl }}
          style={[
            { width, height: Math.round(width * 1.4) },
            // Grayscale where the platform supports CSS filters; opacity greys it everywhere.
            tone.grayscale ? ({ filter: "grayscale(1)" } as object) : null,
          ]}
        />
      ) : (
        <View style={[styles.noArt, { width, height: Math.round(width * 1.4) }]} />
      )}
      <Text numberOfLines={1} style={styles.label}>
        {card.localId} {card.name}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.md },
  columns: { gap: space.sm, marginBottom: space.sm },
  tile: { alignItems: "center" },
  noArt: { backgroundColor: colors.muted, borderRadius: 6 },
  label: { color: colors.text, fontSize: 12, height: 28, paddingTop: 4 },
});
