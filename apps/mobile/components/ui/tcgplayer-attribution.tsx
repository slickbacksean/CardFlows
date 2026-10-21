import { TCGPLAYER_NOTICE } from "@cardflow/shared";
import { Linking, StyleSheet, Text, View } from "react-native";
import { colors } from "@/lib/theme";

/** Policy Reviewer (Oct 20): required wherever a TCGplayer price is shown. */
export const TCGPLAYER_SOURCE_LABEL = "Price source: TCGplayer";
export const TCGPLAYER_LINK_LABEL = "View on TCGplayer";

/**
 * Compact footnote: names TCGplayer as the source, shows the required notice, and links to the
 * card's TCGplayer product page when a URL is known.
 */
export function TcgplayerAttribution({ url }: { url?: string | null }) {
  return (
    <View accessibilityLabel={`${TCGPLAYER_SOURCE_LABEL}. ${TCGPLAYER_NOTICE}`} style={styles.wrap}>
      <Text style={styles.text}>
        {TCGPLAYER_SOURCE_LABEL}
        {url ? (
          <>
            {" · "}
            <Text accessibilityRole="link" onPress={() => void Linking.openURL(url).catch(() => undefined)} style={styles.link}>
              {TCGPLAYER_LINK_LABEL}
            </Text>
          </>
        ) : null}
      </Text>
      <Text style={styles.text}>{TCGPLAYER_NOTICE}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 2, marginTop: 6 },
  text: { color: colors.muted, fontSize: 11, lineHeight: 15 },
  link: { color: colors.muted, fontSize: 11, textDecorationLine: "underline" },
});
