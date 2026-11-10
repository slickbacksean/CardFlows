import {
  TCGCSV_NOTICE,
  TCGCSV_SITE_URL,
  TCGCSV_SOURCE_LABEL,
  TCGPLAYER_NOTICE,
} from "@cardflow/shared";
import { Linking, StyleSheet, Text, View } from "react-native";
import { colors } from "@/lib/theme";

interface TrendingPriceAttributionProps {
  sourceLabel?: string;
  notice?: string;
  siteUrl?: string;
  siteLabel?: string;
}

/**
 * Required wherever snapshotted market prices are shown on Trending.
 * Defaults to TCGCSV (the production snapshot source); pass payload.attribution
 * when the API is using the pokemontcg.io fallback.
 */
export function PokemonTcgAttribution(props: TrendingPriceAttributionProps = {}) {
  const sourceLabel = props.sourceLabel ?? TCGCSV_SOURCE_LABEL;
  const notice = props.notice ?? TCGCSV_NOTICE;
  const siteUrl = props.siteUrl ?? TCGCSV_SITE_URL;
  const siteLabel = props.siteLabel ?? "tcgcsv.com";
  return (
    <View
      accessibilityLabel={`${sourceLabel}. ${notice} ${TCGPLAYER_NOTICE}`}
      style={styles.wrap}
    >
      <Text style={styles.text}>
        {sourceLabel}
        {" · "}
        <Text
          accessibilityRole="link"
          onPress={() => void Linking.openURL(siteUrl).catch(() => undefined)}
          style={styles.link}
        >
          {siteLabel}
        </Text>
      </Text>
      <Text style={styles.text}>{notice}</Text>
      <Text style={styles.text}>{TCGPLAYER_NOTICE}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 2, marginTop: 6 },
  text: { color: colors.muted, fontSize: 11, lineHeight: 15 },
  link: { color: colors.muted, fontSize: 11, textDecorationLine: "underline" },
});
