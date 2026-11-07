import { POKEMONTCG_NOTICE, POKEMONTCG_SITE_URL, POKEMONTCG_SOURCE_LABEL, TCGPLAYER_NOTICE } from "@cardflow/shared";
import { Linking, StyleSheet, Text, View } from "react-native";
import { colors } from "@/lib/theme";

/**
 * Required wherever pokemontcg.io market prices are shown. Names the Pokémon TCG API,
 * links to pokemontcg.io, and repeats the TCGplayer notice for the underlying market fields.
 */
export function PokemonTcgAttribution() {
  return (
    <View
      accessibilityLabel={`${POKEMONTCG_SOURCE_LABEL}. ${POKEMONTCG_NOTICE} ${TCGPLAYER_NOTICE}`}
      style={styles.wrap}
    >
      <Text style={styles.text}>
        {POKEMONTCG_SOURCE_LABEL}
        {" · "}
        <Text
          accessibilityRole="link"
          onPress={() => void Linking.openURL(POKEMONTCG_SITE_URL).catch(() => undefined)}
          style={styles.link}
        >
          pokemontcg.io
        </Text>
      </Text>
      <Text style={styles.text}>{POKEMONTCG_NOTICE}</Text>
      <Text style={styles.text}>{TCGPLAYER_NOTICE}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 2, marginTop: 6 },
  text: { color: colors.muted, fontSize: 11, lineHeight: 15 },
  link: { color: colors.muted, fontSize: 11, textDecorationLine: "underline" },
});
