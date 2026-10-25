import { LIVESTREAM_DISABLED_COPY } from "@cardflow/shared";
import type { ComponentProps } from "react";
import { Tabs, usePathname } from "expo-router";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useLivestreamEnabled } from "@/lib/feature-flags";
import { ScanTabButton } from "@/components/ui/scan-tab-button";
import { TabBarCurve } from "@/components/ui/tab-bar-curve";
import {
  TAB_CENTER_WIDTH,
  TAB_CURVE_RADIUS,
  TAB_GLYPH_SIZE,
  TAB_ICON_SIZE,
  TAB_LABEL_SIZE,
  TAB_ROW_HEIGHT,
} from "@/components/ui/tab-bar-metrics";
import { colors } from "@/lib/theme";

type AppTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

const LEFT_TAB_NAMES = ["collection", "shop"];
const RIGHT_TAB_NAMES = ["grading", "community"];

function routesByName(
  routes: AppTabBarProps["state"]["routes"],
  names: string[],
) {
  return names
    .map((name) => routes.find((route) => route.name === name))
    .filter((route): route is (typeof routes)[number] => route != null);
}

export function AppTabBar({ state, descriptors, navigation, insets }: AppTabBarProps) {
  const pathname = usePathname();
  const livestreamEnabled = useLivestreamEnabled();
  const focusedRoute = state.routes[state.index];
  if (focusedRoute?.name === "scan-tab" || /\/shop\/card(?:\/|$)/.test(pathname)) return null;

  const leftRoutes = routesByName(state.routes, LEFT_TAB_NAMES);
  const rightRoutes = routesByName(state.routes, RIGHT_TAB_NAMES);
  const scanRoute = state.routes.find((route) => route.name === "scan-tab");

  function renderTab(route: (typeof state.routes)[number]) {
    const index = state.routes.findIndex((item) => item.key === route.key);
    const { options } = descriptors[route.key];
    const focused = state.index === index;
    const color = focused ? colors.accent : colors.muted;
    const icon = options.tabBarIcon?.({ focused, color, size: TAB_GLYPH_SIZE });
    const label =
      typeof options.tabBarLabel === "string"
        ? options.tabBarLabel
        : typeof options.title === "string"
          ? options.title
          : route.name;

    return (
      <Pressable
        key={route.key}
        accessibilityLabel={label}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        onPress={() => {
          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        }}
        style={styles.item}
      >
        <View style={styles.square}>{icon}</View>
        <Text numberOfLines={1} style={[styles.label, { color }]}>
          {label}
        </Text>
      </Pressable>
    );
  }

  return (
    <View pointerEvents="box-none" style={styles.dock}>
      <View style={styles.bump} />
      <TabBarCurve />
      <View style={[styles.row, { paddingBottom: insets.bottom }]}>
        <View style={styles.side}>{leftRoutes.map(renderTab)}</View>
        <View style={styles.center}>
          <View style={styles.plug} />
          <View style={styles.centerFill} />
          <ScanTabButton
            onPress={() => {
              if (!scanRoute) return;
              if (!livestreamEnabled) {
                Alert.alert("Live Scan", LIVESTREAM_DISABLED_COPY);
                return;
              }
              const event = navigation.emit({
                type: "tabPress",
                target: scanRoute.key,
                canPreventDefault: true,
              });
              if (!event.defaultPrevented) {
                navigation.navigate(scanRoute.name);
              }
            }}
          />
        </View>
        <View style={styles.side}>{rightRoutes.map(renderTab)}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    overflow: "visible",
  },
  bump: {
    height: TAB_CURVE_RADIUS,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: colors.bg,
    overflow: "visible",
  },
  side: {
    flex: 1,
    height: TAB_ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "stretch",
    justifyContent: "center",
    backgroundColor: colors.bg,
    overflow: "visible",
  },
  center: {
    width: TAB_CENTER_WIDTH,
    height: TAB_ROW_HEIGHT,
    alignItems: "center",
    justifyContent: "flex-end",
    overflow: "visible",
    zIndex: 2,
  },
  plug: {
    position: "absolute",
    top: -TAB_CURVE_RADIUS,
    width: TAB_CURVE_RADIUS * 2,
    height: TAB_CURVE_RADIUS * 2,
    borderRadius: TAB_CURVE_RADIUS,
    backgroundColor: colors.bg,
  },
  centerFill: {
    position: "absolute",
    left: 0,
    right: 0,
    top: TAB_CURVE_RADIUS,
    bottom: 0,
    backgroundColor: colors.bg,
  },
  item: {
    flex: 1,
    minWidth: 0,
    maxWidth: 72,
    height: TAB_ROW_HEIGHT,
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 3,
  },
  square: {
    width: TAB_ICON_SIZE,
    height: TAB_ICON_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    width: "100%",
    fontSize: TAB_LABEL_SIZE,
    fontWeight: "700",
    letterSpacing: 0.1,
    lineHeight: 11,
    textAlign: "center",
  },
});
