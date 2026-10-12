import Ionicons from "@expo/vector-icons/Ionicons";
import { StyleSheet, TextInput, View } from "react-native";
import { shopColors, shopSpace } from "@/components/shop/shop-theme";
import { radii } from "@/lib/theme";

interface SearchFieldProps {
  value: string;
  placeholder: string;
  onChangeText: (value: string) => void;
}

export function SearchField({ value, placeholder, onChangeText }: SearchFieldProps) {
  return (
    <View style={styles.field}>
      <Ionicons color={shopColors.muted} name="search" size={18} />
      <TextInput
        accessibilityLabel={placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={shopColors.muted}
        returnKeyType="search"
        style={styles.input}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    minHeight: 44,
    borderRadius: radii.pill,
    backgroundColor: shopColors.card,
    borderColor: shopColors.line,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: shopSpace.md,
    flexDirection: "row",
    alignItems: "center",
    gap: shopSpace.sm,
  },
  input: {
    flex: 1,
    color: shopColors.text,
    fontSize: 16,
    paddingVertical: 10,
  },
});
