import Ionicons from "@expo/vector-icons/Ionicons";
import { StyleSheet, TextInput, View } from "react-native";
import { shopColors, shopSpace } from "@/components/shop/shop-theme";

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
    minHeight: 46,
    borderRadius: 23,
    backgroundColor: shopColors.card,
    paddingHorizontal: shopSpace.md,
    flexDirection: "row",
    alignItems: "center",
    gap: shopSpace.sm,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  input: {
    flex: 1,
    color: shopColors.text,
    fontSize: 16,
    paddingVertical: 10,
  },
});
