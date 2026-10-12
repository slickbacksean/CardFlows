import { useRef, useState, type ReactNode } from "react";
import { PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radii } from "@/lib/theme";

interface HudBubbleProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
  live?: boolean;
}

const EDGE = 12;
const TAP_SLOP = 8;

export function HudBubble({ children, title, subtitle, live = false }: HudBubbleProps) {
  const [expanded, setExpanded] = useState(false);
  const expandedRef = useRef(false);
  const [origin, setOrigin] = useState({ x: EDGE, y: EDGE });
  const originRef = useRef(origin);
  const grantRef = useRef(origin);
  const boundsRef = useRef({ width: 0, height: 0 });
  const sizeRef = useRef({ width: 0, height: 0 });
  const userMovedRef = useRef(false);

  function place(next: { x: number; y: number }) {
    const maxX = Math.max(EDGE, boundsRef.current.width - sizeRef.current.width - EDGE);
    const maxY = Math.max(EDGE, boundsRef.current.height - sizeRef.current.height - EDGE);
    const clamped = {
      x: Math.min(Math.max(EDGE, next.x), maxX),
      y: Math.min(Math.max(EDGE, next.y), maxY),
    };
    if (clamped.x === originRef.current.x && clamped.y === originRef.current.y) return;
    originRef.current = clamped;
    setOrigin(clamped);
  }

  function snapToAnchor() {
    if (userMovedRef.current) {
      place(originRef.current);
      return;
    }
    place({
      x: boundsRef.current.width - sizeRef.current.width - EDGE,
      y: EDGE,
    });
  }

  function setExpandedState(next: boolean) {
    expandedRef.current = next;
    setExpanded(next);
  }

  // Refs are read only inside the gesture callbacks, never during render.
  // eslint-disable-next-line react-hooks/refs
  const [pan] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        userMovedRef.current = true;
        grantRef.current = originRef.current;
      },
      onPanResponderMove: (_event, gesture) => {
        place({
          x: grantRef.current.x + gesture.dx,
          y: grantRef.current.y + gesture.dy,
        });
      },
      onPanResponderRelease: (_event, gesture) => {
        place({
          x: grantRef.current.x + gesture.dx,
          y: grantRef.current.y + gesture.dy,
        });
        if (!expandedRef.current && Math.hypot(gesture.dx, gesture.dy) < TAP_SLOP) {
          setExpandedState(true);
        }
      },
    }),
  );

  return (
    <View
      pointerEvents="box-none"
      style={styles.stage}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        boundsRef.current = { width, height };
        snapToAnchor();
      }}
    >
      <View
        pointerEvents="box-none"
        style={[styles.bubble, { left: origin.x, top: origin.y }]}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          sizeRef.current = { width, height };
          snapToAnchor();
        }}
      >
        {expanded ? (
          <View style={styles.card}>
            <View style={styles.header}>
              <View
                accessibilityHint="Drag to move the overlay"
                accessibilityLabel="Drag CardFlow overlay"
                accessibilityRole="adjustable"
                style={styles.grip}
                {...pan.panHandlers}
              >
                <View style={[styles.dot, live ? styles.dotLive : styles.dotIdle]} />
                <Text numberOfLines={1} style={styles.headerTitle}>
                  {title}
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Collapse overlay"
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => setExpandedState(false)}
                style={styles.collapse}
              >
                <Text style={styles.collapseLabel}>–</Text>
              </Pressable>
            </View>
            {children}
          </View>
        ) : (
          <View
            accessibilityHint="Drag to move. Tap to open the overlay."
            accessibilityLabel={`${title}. CardFlow overlay`}
            accessibilityRole="button"
            style={styles.pill}
            {...pan.panHandlers}
          >
            <View style={[styles.mark, live ? styles.markLive : null]}>
              <Text style={[styles.markLabel, live ? styles.markLabelLive : null]}>CF</Text>
            </View>
            <View style={styles.pillCopy}>
              <Text numberOfLines={1} style={styles.pillTitle}>
                {title}
              </Text>
              {subtitle ? (
                <Text numberOfLines={1} style={styles.pillSubtitle}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const floating = {
  shadowColor: "#000000",
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.35,
  shadowRadius: 16,
  elevation: 8,
};

const styles = StyleSheet.create({
  stage: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  bubble: {
    position: "absolute",
  },
  pill: {
    maxWidth: 248,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: 12,
    borderRadius: radii.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    ...floating,
  },
  mark: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    backgroundColor: colors.elevated,
    alignItems: "center",
    justifyContent: "center",
  },
  markLive: {
    backgroundColor: colors.accent,
  },
  markLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
  },
  markLabelLive: {
    color: colors.accentText,
  },
  pillCopy: {
    flexShrink: 1,
    minWidth: 0,
    gap: 1,
  },
  pillTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  pillSubtitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
  },
  card: {
    width: 292,
    borderRadius: radii.lg,
    overflow: "hidden",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    ...floating,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.elevated,
  },
  grip: {
    flex: 1,
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 12,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radii.pill,
  },
  dotLive: {
    backgroundColor: colors.accent,
  },
  dotIdle: {
    backgroundColor: colors.muted,
  },
  headerTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
  },
  collapse: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  collapseLabel: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
  },
});
