import { Image } from "expo-image";
import { memo, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { shopColors } from "@/components/shop/shop-theme";
import { formatDexNumber, type DexEntry } from "@/lib/shop-dex";
import { loadDefaultCardArt } from "@/lib/shop-catalog";

interface DexTileProps {
  entry: DexEntry;
  width: number;
  onPress: (entry: DexEntry) => void;
}

export const DexTile = memo(function DexTile({ entry, width, onPress }: DexTileProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadDefaultCardArt(entry.name).then((url) => {
      if (!cancelled) setImageUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [entry.name]);

  return (
    <Pressable
      accessibilityLabel={`${entry.name}, ${formatDexNumber(entry.dexId)}`}
      accessibilityRole="button"
      onPress={() => onPress(entry)}
      style={[styles.tile, { width }]}
    >
      {imageUrl ? (
        <Image
          accessibilityIgnoresInvertColors
          cachePolicy="memory-disk"
          contentFit="contain"
          source={{ uri: imageUrl }}
          style={styles.art}
        />
      ) : (
        <View style={styles.art} />
      )}
      <Text numberOfLines={1} style={styles.name}>
        {entry.name}
      </Text>
      <Text style={styles.number}>{formatDexNumber(entry.dexId)}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  tile: {
    alignItems: "center",
    gap: 4,
  },
  art: {
    width: "100%",
    aspectRatio: 0.72,
    borderRadius: 12,
    backgroundColor: "#E4E4EA",
  },
  name: {
    color: shopColors.text,
    fontSize: 15,
    fontWeight: "800",
    textAlign: "center",
  },
  number: {
    color: shopColors.muted,
    fontSize: 12,
    fontWeight: "600",
  },
});
