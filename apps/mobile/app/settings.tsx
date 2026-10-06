import {
  MARKETPLACE_AUTOMATION_NO_ENABLE_COPY,
  SETTINGS_KICKER,
  SETTINGS_RESEARCH_FLAGS,
  SETTINGS_RESEARCH_SECTION_LABEL,
  SETTINGS_STACK_SECTION_LABEL,
  SETTINGS_STACK_STATUS_ROWS,
  featureFlagStateLabel,
  settingsJobLabel,
  settingsKickerForIdentity,
  settingsStackStatusValue,
  type CardFlowHealth,
  type InvitedIdentity,
  type SettingsStackLoad,
} from "@cardflow/shared";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { PreferencesScreenHeader } from "@/components/ui/preferences-screen-header";
import { getHealth } from "@/lib/api";
import {
  loadIdentitySession,
} from "@/lib/identity";
import { colors, space } from "@/lib/theme";

export default function SettingsScreen() {
  const router = useRouter();
  const [kicker, setKicker] = useState(SETTINGS_KICKER);
  const [identity, setIdentity] = useState<InvitedIdentity | null>(null);
  const [stack, setStack] = useState<CardFlowHealth | null>(null);
  const [stackLoad, setStackLoad] = useState<SettingsStackLoad>("checking");

  const applySession = useCallback(
    (session: { identity: InvitedIdentity | null }) => {
      setIdentity(session.identity);
      setKicker(settingsKickerForIdentity(session.identity));
    },
    [],
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void loadIdentitySession()
        .then((session) => {
          if (cancelled) return;
          applySession(session);
        })
        .catch(() => {
          if (cancelled) return;
          applySession({ identity: null });
          setKicker(SETTINGS_KICKER);
        });
      void getHealth()
        .then((health) => {
          if (cancelled) return;
          setStack(health);
          setStackLoad("ready");
        })
        .catch(() => {
          if (cancelled) return;
          setStack(null);
          setStackLoad("unavailable");
        });
      return () => {
        cancelled = true;
      };
    }, [applySession]),
  );

  return (
    <View style={styles.flex}>
      <PreferencesScreenHeader dismiss="close" title="Settings" />
      <ScrollView contentContainerStyle={styles.content} style={styles.flex}>
        <Text style={styles.kicker}>{kicker}</Text>

        <Text style={styles.sectionFirst}>This tester</Text>
        <Text style={styles.body}>{identity?.label ?? "No invite session"}</Text>
        <JobRow
          label="Use a different invite code"
          onPress={() => router.push("/switch-tester")}
        />

        <JobRow
          label={settingsJobLabel("max_buy_rules")}
          onPress={() => router.push("/max-buy-rules")}
        />

        <Text style={styles.section}>{SETTINGS_STACK_SECTION_LABEL}</Text>
        {SETTINGS_STACK_STATUS_ROWS.map((row) => {
          const value = settingsStackStatusValue(stack, row.id, stackLoad);
          return (
            <View
              accessibilityLabel={`${row.label} ${value}`}
              accessibilityRole="text"
              key={row.id}
              pointerEvents="none"
              style={styles.flagRow}
            >
              <Text style={styles.flagLabel}>{row.label}</Text>
              <Text style={styles.flagValue}>{value}</Text>
            </View>
          );
        })}

        <Text style={styles.section}>{SETTINGS_RESEARCH_SECTION_LABEL}</Text>
        {SETTINGS_RESEARCH_FLAGS.map((flag) => {
          const stateLabel = featureFlagStateLabel(flag.enabled);
          return (
            <View
              accessibilityLabel={`${flag.label} ${stateLabel}`}
              accessibilityRole="text"
              key={flag.id}
              pointerEvents="none"
              style={styles.flagRow}
            >
              <Text style={styles.flagLabel}>{flag.label}</Text>
              <Text style={styles.flagValue}>{stateLabel}</Text>
            </View>
          );
        })}
        <Text style={styles.body}>{MARKETPLACE_AUTOMATION_NO_ENABLE_COPY}</Text>

        <JobRow
          label={settingsJobLabel("about")}
          onPress={() => router.push("/about")}
        />
      </ScrollView>
    </View>
  );
}

interface JobRowProps {
  label: string;
  onPress: () => void;
}

function JobRow({ label, onPress }: JobRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={styles.row}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      <Ionicons color={colors.muted} name="chevron-forward" size={20} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  content: {
    padding: space.lg,
    paddingBottom: 48,
    gap: space.sm,
  },
  kicker: { color: colors.accent, fontWeight: "700", letterSpacing: 0.6 },
  sectionFirst: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
    marginTop: space.xs,
  },
  section: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
    marginTop: space.md,
  },
  row: {
    marginTop: space.sm,
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.sm,
  },
  rowLabel: { color: colors.text, fontSize: 16, fontWeight: "700" },
  notThisTester: { marginTop: space.xs, paddingVertical: space.sm },
  notThisTesterLabel: { color: colors.muted, fontSize: 15, fontWeight: "600" },
  flagRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    paddingVertical: 8,
  },
  flagLabel: { color: colors.text, fontSize: 15, flex: 1 },
  flagValue: { color: colors.muted, fontSize: 13, fontWeight: "800", letterSpacing: 0.6 },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
});
