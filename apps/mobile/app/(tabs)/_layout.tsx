import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs, usePathname } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppHeader } from "@/components/ui/app-header";
import { AppTabBar } from "@/components/ui/app-tab-bar";
import { TAB_ROW_HEIGHT } from "@/components/ui/tab-bar-metrics";
import { colors } from "@/lib/theme";

export const unstable_settings = {
  initialRouteName: "collection",
};

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const isScreenerOpen = pathname === "/scan-tab";
  const isShopDrillIn = /\/shop\/.+/.test(pathname);
  const isShopCard = /\/shop\/card(?:\/|$)/.test(pathname);

  return (
    <View style={styles.shell}>
      {isScreenerOpen || isShopDrillIn ? null : <AppHeader />}
      <Tabs
        tabBar={(props) => <AppTabBar {...props} />}
        screenOptions={{
          headerShown: false,
          sceneStyle: {
            backgroundColor: colors.bg,
            paddingBottom: isScreenerOpen || isShopCard ? 0 : TAB_ROW_HEIGHT + insets.bottom,
          },
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.muted,
          tabBarStyle: {
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 0,
            backgroundColor: "transparent",
            borderTopWidth: 0,
            elevation: 0,
            overflow: "visible",
          },
        }}
      >
        <Tabs.Screen name="index" options={{ href: null }} />
        <Tabs.Screen
          name="collection"
          options={{
            title: "Collection",
            tabBarLabel: "Collection",
            tabBarIcon: ({ color, focused, size }) => (
              <Ionicons name={focused ? "grid" : "grid-outline"} size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="shop"
          options={{
            title: "Shop",
            tabBarLabel: "Shop",
            tabBarIcon: ({ color, focused, size }) => (
              <Ionicons name={focused ? "cart" : "cart-outline"} size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="scan-tab"
          options={{
            title: "Livestream Screener",
            tabBarLabel: "Livestream Screener",
            sceneStyle: { backgroundColor: colors.bg, paddingBottom: 0 },
          }}
        />
        <Tabs.Screen
          name="grading"
          options={{
            title: "Grading",
            tabBarLabel: "Grading",
            tabBarIcon: ({ color, focused, size }) => (
              <Ionicons
                name={focused ? "diamond" : "diamond-outline"}
                size={size}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="export"
          options={{
            title: "Export",
            tabBarLabel: "Export",
            tabBarIcon: ({ color, focused, size }) => (
              <Ionicons
                name={focused ? "download" : "download-outline"}
                size={size}
                color={color}
              />
            ),
          }}
        />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.bg },
});
