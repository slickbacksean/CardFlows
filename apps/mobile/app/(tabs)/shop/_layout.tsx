import { Stack } from "expo-router";
import { shopColors } from "@/components/shop/shop-theme";

export default function ShopLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: shopColors.bg },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="pokemon/[dexId]" />
      <Stack.Screen name="set" />
      <Stack.Screen
        name="card"
        options={{ presentation: "modal", animation: "slide_from_bottom" }}
      />
    </Stack>
  );
}
