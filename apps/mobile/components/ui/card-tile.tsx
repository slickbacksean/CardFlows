import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, space } from "@/lib/theme";

export interface CardTileProps {
  placeholder?: boolean;
  name?: string;
  localId?: string;
  language?: string;
  imageUrl?: string | null;
  intent?: "purchased" | "watchlist";
  allInAmount?: string | null;
  targetMaxBuyDisplay?: string | null;
  hasDraft?: boolean;
  showDraftCta?: boolean;
  onPress?: () => void;
}

export function CardTile({
  placeholder = false,
  name,
  localId,
  language = "EN",
  imageUrl,
  intent,
  allInAmount,
  targetMaxBuyDisplay,
  hasDraft = false,
  showDraftCta = false,
  onPress,
}: CardTileProps) {
  if (placeholder) {
    return (
      <View
        accessibilityLabel="Empty card slot"
        style={[styles.tile, styles.placeholder]}
      >
        <View style={styles.artSlot} />
        <View style={styles.meta} />
      </View>
    );
  }

  const numberLine = localId ? `#${localId} ${language}` : language;
  const statusLabel = intent === "watchlist" ? "watching" : "purchased";
  const valueLabel =
    intent === "watchlist"
      ? targetMaxBuyDisplay
        ? `target Max Buy ${targetMaxBuyDisplay}`
        : "target Max Buy"
      : allInAmount
        ? `all-in $${allInAmount}`
        : null;
  const showDraft = intent === "purchased" && (hasDraft || showDraftCta);

  return (
    <Pressable
      accessibilityLabel={[name, numberLine, statusLabel, valueLabel, showDraft ? "Draft" : null]
        .filter(Boolean)
        .join(", ")}
      accessibilityRole={onPress ? "button" : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={styles.tile}
    >
      {imageUrl ? (
        <Image
          accessibilityIgnoresInvertColors
          contentFit="cover"
          source={{ uri: imageUrl }}
          style={styles.art}
        />
      ) : (
        <View style={styles.artSlot} />
      )}
      <View style={styles.meta}>
        <Text numberOfLines={1} style={styles.name}>
          {name ?? "Card"}
        </Text>
        <Text style={styles.line}>{numberLine}</Text>
        <Text style={styles.line}>{statusLabel}</Text>
        {valueLabel ? <Text style={styles.line}>{valueLabel}</Text> : null}
        {showDraft ? <Text style={styles.draft}>Draft</Text> : null}
        {intent === "watchlist" ? (
          <Text style={styles.line}>cannot draft</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 16,
    overflow: "hidden",
  },
  placeholder: {
    borderStyle: "dashed",
    opacity: 0.55,
  },
  art: {
    width: "100%",
    aspectRatio: 0.715,
    backgroundColor: colors.chip,
  },
  artSlot: {
    width: "100%",
    aspectRatio: 0.715,
    backgroundColor: colors.chip,
  },
  meta: {
    padding: space.sm,
    gap: 2,
  },
  name: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  line: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
  },
  draft: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
});
