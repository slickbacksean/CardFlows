import { Image } from "expo-image";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radii, space, type } from "@/lib/theme";

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
  detailsNeeded?: boolean;
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
  detailsNeeded = false,
  onPress,
}: CardTileProps) {
  if (placeholder) {
    return (
      <View accessibilityLabel="Empty card slot" style={[styles.tile, styles.placeholder]}>
        <View style={styles.artSlot} />
        <View style={styles.meta} />
      </View>
    );
  }

  const numberLine = localId ? `#${localId} ${language}` : language;
  const statusLabel = intent === "watchlist" ? "Watch" : "Owned";
  const valueLabel =
    intent === "watchlist"
      ? targetMaxBuyDisplay
        ? `Max ${targetMaxBuyDisplay}`
        : "Max buy"
      : allInAmount
        ? `$${allInAmount}`
        : null;
  const showDraft = intent === "purchased" && (hasDraft || showDraftCta);

  return (
    <Pressable
      accessibilityLabel={[
        name,
        numberLine,
        statusLabel,
        valueLabel,
        detailsNeeded ? "Details needed" : null,
        showDraft ? "Draft" : null,
      ]
        .filter(Boolean)
        .join(", ")}
      accessibilityRole={onPress ? "button" : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={styles.tile}
    >
      <View>
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
        {intent ? (
          <View style={[styles.badge, intent === "watchlist" && styles.badgeWatch]}>
            <Text style={[styles.badgeText, intent === "watchlist" && styles.badgeTextWatch]}>
              {statusLabel}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.meta}>
        <Text numberOfLines={1} style={styles.name}>
          {name ?? "Card"}
        </Text>
        <Text numberOfLines={1} style={styles.price}>
          {valueLabel ?? numberLine}
        </Text>
        {detailsNeeded ? <Text style={styles.detailsNeeded}>Details needed</Text> : null}
        {showDraft ? <Text style={styles.draft}>Draft</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
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
  badge: {
    position: "absolute",
    top: 6,
    left: 6,
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeWatch: {
    backgroundColor: colors.chip,
    borderColor: colors.cardBorder,
    borderWidth: StyleSheet.hairlineWidth,
  },
  badgeText: {
    color: colors.accentText,
    ...type.caption,
  },
  badgeTextWatch: {
    color: colors.text,
  },
  meta: {
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    gap: 1,
  },
  name: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  price: {
    color: colors.text,
    ...type.price,
  },
  draft: {
    color: colors.accent,
    ...type.caption,
  },
  detailsNeeded: {
    color: colors.accent,
    ...type.caption,
  },
});
